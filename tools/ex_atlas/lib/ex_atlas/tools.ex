defmodule ExAtlas.Tools do
  @moduledoc "MCP tool definitions and their implementations over the project index."

  alias ExAtlas.{Context, Indexer, Index, Learnings, Patterns, Search, UsageLog}

  @str %{"type" => "string"}
  @strs %{"type" => "array", "items" => %{"type" => "string"}}

  defp tool(name, description, props, required) do
    %{
      "name" => name,
      "description" => description,
      "inputSchema" => %{"type" => "object", "properties" => props, "required" => required}
    }
  end

  @spec list() :: [map()]
  def list do
    [
      tool(
        "context_for_task",
        "Call BEFORE implementing anything: returns the project's architecture rules and the patterns for the areas you will touch. Areas are the first namespace segment under the app, lowercase, e.g. payroll; web for the web layer; core for app-root modules. Unknown areas are reported with the list of known ones.",
        %{
          "task" => @str,
          "areas" => @strs,
          "budget" => %{"type" => "integer", "description" => "Token budget (default 8000)"}
        },
        ["task", "areas"]
      ),
      tool(
        "find_reusable",
        "Call before writing any new function: finds existing functions that already do it.",
        %{
          "query" => @str,
          "limit" => %{"type" => "integer", "minimum" => 1},
          "include_private" => %{"type" => "boolean"}
        },
        ["query"]
      ),
      tool(
        "module",
        "Lists every function of a module with its doc, spec, line and callers.",
        %{"name" => @str},
        ["name"]
      ),
      tool(
        "callers",
        "Lists the callers of a function id such as \"Fx.Accounts.fetch/1\" with file and line.",
        %{"id" => @str},
        ["id"]
      ),
      tool(
        "reindex",
        "Recompiles and re-indexes the project; returns changed files, degraded mode and stale pattern entries.",
        %{"full" => %{"type" => "boolean"}},
        []
      ),
      tool(
        "record_pattern",
        "Adds, updates or retires a pattern entry of an area. Evidence must name existing functions or modules.",
        %{
          "area" => @str,
          "op" => %{"type" => "string", "enum" => ["add", "update", "retire"]},
          "entry" => %{"type" => "object"}
        },
        ["area", "op", "entry"]
      ),
      tool(
        "set_purpose",
        "Sets the one-line purpose of a function id so search finds it by intent.",
        %{"area" => @str, "id" => @str, "text" => @str},
        ["area", "id", "text"]
      ),
      tool(
        "record_learning",
        "For the ex-atlas-learn reviewer only; implementing agents must not call this. Records a search miss or an ignored result: project, branch, cause (tool_miss|agent_ignored), query, tool (find_reusable|context_for_task), expected (function id or pattern entry id), actual (what the tool returned, e.g. a rank), evidence; args (object) is required for context_for_task as {task, areas} and defaults to {query} for find_reusable.",
        %{
          "project" => @str,
          "branch" => @str,
          "cause" => %{"type" => "string", "enum" => ["tool_miss", "agent_ignored"]},
          "query" => @str,
          "tool" => %{"type" => "string", "enum" => ["find_reusable", "context_for_task"]},
          "expected" => @str,
          "actual" => %{"description" => "Any JSON value"},
          "evidence" => @str,
          "args" => %{"type" => "object"}
        },
        ~w(project branch cause query tool expected actual evidence)
      )
    ]
  end

  @doc "Checks required args and JSON types against the tool's schema."
  @spec validate(String.t(), map()) :: :ok | {:error, String.t()}
  def validate(name, args) do
    case Enum.find(list(), &(&1["name"] == name)) do
      nil ->
        :ok

      %{"inputSchema" => %{"properties" => props, "required" => required}} ->
        with nil <- Enum.find(required, &(not Map.has_key?(args, &1))) |> missing(),
             nil <- Enum.find_value(args, fn {k, v} -> props[k] && mistyped(k, v, props[k]) end) do
          :ok
        end
    end
  end

  defp missing(nil), do: nil
  defp missing(key), do: {:error, "missing required argument: #{key}"}

  defp mistyped(k, v, schema) do
    if type?(v, schema), do: nil, else: {:error, "invalid type for argument: #{k}"}
  end

  defp type?(v, %{"type" => "string"}), do: is_binary(v)
  defp type?(v, %{"type" => "integer"}), do: is_integer(v)
  defp type?(v, %{"type" => "boolean"}), do: is_boolean(v)
  defp type?(v, %{"type" => "object"}), do: is_map(v)
  defp type?(v, %{"type" => "array"}), do: is_list(v) and Enum.all?(v, &is_binary/1)
  defp type?(_, _), do: true

  @spec call(String.t(), map(), map()) :: {:ok, map(), map()} | {:error, String.t()}
  def call(name, args, state),
    do: safely(fn -> do_call(name, args, ensure_index(name, state)) end)

  # The server starts without an index; the first tool that needs one builds it via `state.loader`.
  defp ensure_index(name, %{index: nil, loader: loader} = state)
       when name not in ["reindex", "record_learning"],
       do: %{state | index: loader.()}

  defp ensure_index(_, state), do: state

  @doc false
  # A tool must never take the server down: exceptions, throws and exits become errors.
  @spec safely((-> {:ok, map(), map()} | {:error, String.t()})) ::
          {:ok, map(), map()} | {:error, String.t()}
  def safely(fun) do
    fun.()
  rescue
    e -> {:error, Exception.message(e)}
  catch
    kind, reason -> {:error, "#{kind}: #{inspect(reason)}"}
  end

  defp do_call("context_for_task", args, state) do
    loaded = Patterns.load_all(state.dir)
    opts = if args["budget"], do: [budget: args["budget"]], else: []
    result = Context.build(state.index, loaded, args["task"], args["areas"], opts)

    entries =
      Enum.concat([
        result.global,
        Enum.flat_map(result.areas, fn {_, v} -> v.entries end),
        Enum.flat_map(result.neighbours, fn {_, v} -> v.entries end)
      ])

    UsageLog.append(state.dir, "context_for_task", args, Enum.map(entries, & &1["id"]))
    {:ok, result, state}
  end

  defp do_call("find_reusable", args, state) do
    loaded = Patterns.load_all(state.dir)

    opts =
      [limit: args["limit"], include_private: args["include_private"]]
      |> Enum.reject(fn {_, v} -> is_nil(v) end)

    {corpus, state} = cached_corpus(state, loaded)
    results = Search.find(corpus, args["query"], opts)
    ids = Enum.flat_map(results, fn r -> [r.id | Enum.map(r.copies, & &1.id)] end) |> Enum.uniq()
    UsageLog.append(state.dir, "find_reusable", args, ids)
    {:ok, %{results: results}, state}
  end

  defp do_call("module", %{"name" => name}, state) do
    case Enum.find(state.index.modules, fn {mod, _} -> inspect(mod) == name end) do
      nil ->
        {:error, "unknown module: #{name}"}

      {mod, info} ->
        functions =
          for {_, f} <- state.index.functions, f.module == mod do
            %{
              id: f.id,
              kind: f.kind,
              line: f.line,
              doc: f.doc,
              spec: f.spec,
              callers: Index.callers_of(state.index, f.id)
            }
          end

        {:ok,
         %{
           module: name,
           file: info.file,
           area: info.area,
           moduledoc: info.moduledoc,
           functions: Enum.sort_by(functions, & &1.id)
         }, state}
    end
  end

  defp do_call("callers", %{"id" => id}, state) do
    callers =
      for c <- Enum.sort(Index.callers_of(state.index, id)), f = state.index.functions[c] do
        %{id: c, file: f.file, line: f.line}
      end

    {:ok, %{id: id, callers: callers}, state}
  end

  defp do_call("reindex", args, state) do
    {:ok, index, report} = Indexer.run(state.root, full: args["full"] == true)
    stale = Patterns.stale(Patterns.load_all(state.dir), index)
    {:ok, Map.put(report, :stale, stale), state |> Map.put(:index, index) |> Map.delete(:search)}
  end

  defp do_call("record_pattern", args, state) do
    case Patterns.record(state.dir, state.index, args["area"], args["op"], args["entry"]) do
      {:ok, entry} -> {:ok, %{entry: entry}, state}
      {:error, msg} -> {:error, msg}
    end
  end

  defp do_call("set_purpose", args, state) do
    case Patterns.set_purpose(state.dir, state.index, args["area"], args["id"], args["text"]) do
      :ok -> {:ok, %{ok: true}, state}
      {:error, msg} -> {:error, msg}
    end
  end

  defp do_call("record_learning", args, state) when is_map(args) do
    case Learnings.record(Learnings.repo_root(), args) do
      :ok -> {:ok, %{ok: true}, state}
      {:error, msg} -> {:error, msg}
    end
  end

  defp do_call("record_learning", _, _), do: {:error, "learning must be an object"}
  defp do_call(name, _, _), do: {:error, "unknown tool: #{name}"}

  # The search corpus is rebuilt when the index is replaced (reindex drops it) or patterns change.
  defp cached_corpus(state, loaded) do
    purposes = Patterns.purposes(loaded)
    texts = Patterns.pattern_text(loaded)
    key = :erlang.phash2({purposes, texts}, 4_294_967_296)

    case Map.get(state, :search) do
      {^key, corpus} ->
        {corpus, state}

      _ ->
        corpus = Search.corpus(state.index, purposes, texts)
        {corpus, Map.put(state, :search, {key, corpus})}
    end
  end
end
