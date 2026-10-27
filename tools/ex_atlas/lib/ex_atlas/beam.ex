defmodule ExAtlas.Beam do
  @moduledoc """
  Reads definitions, docs, specs and call edges from a compiled beam's debug info.
  """

  def read(beam) when is_binary(beam) do
    with {:ok, {mod, [debug_info: {:debug_info_v1, backend, data}]}} <-
           :beam_lib.chunks(beam, [:debug_info]),
         {:ok, info} <- backend.debug_info(:elixir_v1, mod, data, []) do
      {:ok, build(beam, mod, info)}
    else
      _ -> {:error, :no_debug_info}
    end
  end

  defp build(beam, mod, %{file: file, definitions: definitions}) do
    {moduledoc, docs} = fetch_docs(beam)
    specs = fetch_specs(beam)
    own = MapSet.new(definitions, fn {{name, arity}, _kind, _meta, _clauses} -> {name, arity} end)

    defs =
      for {{name, arity}, kind, meta, _clauses} <- definitions do
        {doc, doc_rest} = Map.get(docs, {name, arity}, {nil, nil})

        %{
          name: name,
          arity: arity,
          kind: kind,
          line: Keyword.get(meta, :line),
          doc: doc,
          doc_rest: doc_rest,
          spec: Map.get(specs, {name, arity})
        }
      end

    calls =
      for {{name, arity}, _kind, _meta, clauses} <- definitions,
          {_meta, args, guards, body} <- clauses,
          call <- collect([args, guards, body], mod, own),
          do: {{name, arity}, call}

    %{
      module: mod,
      file: to_string(file),
      moduledoc: moduledoc,
      definitions: defs,
      calls: Enum.uniq(calls)
    }
  end

  defp fetch_docs(beam) do
    # Code.fetch_docs/1 only takes a module or path, so read the chunk from the binary.
    with {:ok, {_, [{~c"Docs", chunk}]}} <- :beam_lib.chunks(beam, [~c"Docs"]),
         {:docs_v1, _, _, _, moduledoc, _, docs} <- :erlang.binary_to_term(chunk) do
      by_fun =
        for {{_kind, n, a}, _, _, %{"en" => d}, _} <- docs,
            into: %{},
            do: {{n, a}, split_paragraphs(d)}

      {moduledoc |> split_paragraphs() |> elem(0), by_fun}
    else
      _ -> {nil, %{}}
    end
  end

  # {first paragraph, rest or nil}
  defp split_paragraphs(%{"en" => text}), do: split_paragraphs(text)

  defp split_paragraphs(text) when is_binary(text) do
    case String.split(text, ~r/\n\s*\n/, parts: 2) do
      [first, rest] -> {String.trim(first), String.trim(rest)}
      [first] -> {String.trim(first), nil}
    end
  end

  defp split_paragraphs(_), do: {nil, nil}

  defp fetch_specs(beam) do
    case Code.Typespec.fetch_specs(beam) do
      {:ok, specs} ->
        for {{name, arity}, clauses} <- specs, into: %{} do
          rendered =
            Enum.map_join(clauses, "\n", fn spec ->
              name |> Code.Typespec.spec_to_quoted(spec) |> Macro.to_string()
            end)

          {{name, arity}, rendered}
        end

      _ ->
        %{}
    end
  end

  defp collect(ast, mod, own) do
    {_, acc} = Macro.prewalk(ast, [], fn node, acc -> visit(node, acc, mod, own) end)
    Enum.reverse(acc)
  end

  # Capture: record {m, f, a} and skip the inner arity-0 remote.
  defp visit({:&, _, [{:/, _, [{{:., _, [m, f]}, _, []}, a]}]}, acc, _mod, _own)
       when is_atom(m) and is_atom(f) and is_integer(a),
       do: {:ok, [{m, f, a} | acc]}

  # Local capture &helper/1: only a call edge when it names one of the module's own definitions.
  defp visit({:&, _, [{:/, _, [{f, _, ctx}, a]}]} = node, acc, mod, own)
       when is_atom(f) and is_atom(ctx) and is_integer(a) do
    if MapSet.member?(own, {f, a}), do: {:ok, [{mod, f, a} | acc]}, else: {node, acc}
  end

  defp visit({{:., _, [m, f]}, _, args} = node, acc, _mod, _own)
       when is_atom(m) and is_atom(f) and is_list(args),
       do: {node, [{m, f, length(args)} | acc]}

  defp visit({f, _, args} = node, acc, mod, own) when is_atom(f) and is_list(args) do
    if MapSet.member?(own, {f, length(args)}),
      do: {node, [{mod, f, length(args)} | acc]},
      else: {node, acc}
  end

  defp visit(node, acc, _mod, _own), do: {node, acc}
end
