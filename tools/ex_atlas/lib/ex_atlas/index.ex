defmodule ExAtlas.Index do
  @moduledoc """
  In-memory index of functions, call edges and modules, persisted as a term file.

  Function ids look like `"Fx.Accounts.fetch/1"` (the `Elixir.` prefix is stripped).
  """

  alias ExAtlas.Area

  defstruct app: nil,
            functions: %{},
            edges: MapSet.new(),
            modules: %{},
            beams: %{},
            built_at: 0,
            degraded_files: [],
            sources: %{}

  @type t :: %__MODULE__{}

  @file_name "index.etf"
  # Bump when the struct or entry shapes change; older files then load as :corrupt.
  @format 3
  @gitignore "/*\n!/.gitignore\n!/patterns/\n"

  @doc "Content of `.ex_atlas/.gitignore`: index ignored, `patterns/` committed."
  @spec gitignore() :: String.t()
  def gitignore, do: @gitignore

  @doc "Creates `dir` and its `.gitignore` if missing."
  @spec ensure_dir(String.t()) :: :ok
  def ensure_dir(dir) do
    File.mkdir_p!(dir)
    path = Path.join(dir, ".gitignore")
    File.exists?(path) || File.write!(path, @gitignore)
    :ok
  end

  @spec new(atom()) :: t()
  def new(app), do: %__MODULE__{app: app, built_at: System.os_time(:second)}

  @spec id({module(), atom(), non_neg_integer()}) :: String.t()
  def id({mod, name, arity}), do: "#{inspect(mod)}.#{name}/#{arity}"

  @doc "Adds or replaces a module, dropping its previous functions and outgoing edges."
  @spec put_module(t(), map(), String.t(), integer(), (String.t() -> boolean())) :: t()
  def put_module(%__MODULE__{} = index, info, beam_path, mtime, dir_exists?) do
    %{module: mod, file: file} = info
    area = Area.of(file, index.app, dir_exists?)

    functions =
      Map.new(info.definitions, fn d ->
        id = id({mod, d.name, d.arity})

        {id,
         %{
           id: id,
           module: mod,
           name: d.name,
           arity: d.arity,
           kind: d.kind,
           file: file,
           line: d.line,
           doc: d.doc,
           doc_rest: d.doc_rest,
           spec: d.spec,
           area: area,
           callers: 0
         }}
      end)

    edges =
      for {{fname, farity}, {m, f, a}} <- info.calls,
          app_module?(index.app, m),
          do: {id({mod, fname, farity}), id({m, f, a})}

    index = drop_module(index, mod)

    %{
      index
      | functions: Map.merge(index.functions, functions),
        edges: MapSet.union(index.edges, MapSet.new(edges)),
        modules:
          Map.put(index.modules, mod, %{
            file: file,
            area: area,
            moduledoc: info.moduledoc,
            beam: beam_path
          }),
        beams: Map.put(index.beams, beam_path, mtime)
    }
  end

  @doc "Removes the module compiled to `beam_path`, if any."
  @spec drop_beam(t(), String.t()) :: t()
  def drop_beam(%__MODULE__{} = index, beam_path) do
    index =
      case Enum.find(index.modules, fn {_, m} -> m.beam == beam_path end) do
        {mod, _} -> drop_module(index, mod)
        nil -> index
      end

    %{index | beams: Map.delete(index.beams, beam_path)}
  end

  @doc "Recomputes `callers`, counting only edges whose target is an indexed function."
  @spec finalize(t()) :: t()
  def finalize(%__MODULE__{} = index) do
    counts =
      index.edges
      |> Enum.filter(fn {_, to} -> is_map_key(index.functions, to) end)
      |> Enum.frequencies_by(fn {_, to} -> to end)

    functions =
      Map.new(index.functions, fn {id, f} -> {id, %{f | callers: Map.get(counts, id, 0)}} end)

    %{index | functions: functions}
  end

  @spec callers_of(t(), String.t()) :: [String.t()]
  def callers_of(%__MODULE__{edges: edges}, id) do
    for {from, ^id} <- edges, do: from
  end

  @doc "Counts edges between distinct areas, keyed by `{from_area, to_area}`."
  @spec area_edges(t()) :: %{{String.t(), String.t()} => pos_integer()}
  def area_edges(%__MODULE__{functions: fns, edges: edges}) do
    edges
    |> Enum.flat_map(fn {from, to} ->
      with %{area: a} <- fns[from],
           %{area: b} when b != a <- fns[to],
           do: [{a, b}],
           else: (_ -> [])
    end)
    |> Enum.frequencies()
  end

  @spec save(t(), String.t()) :: :ok
  def save(%__MODULE__{} = index, dir) do
    ensure_dir(dir)
    File.write!(Path.join(dir, @file_name), :erlang.term_to_binary({@format, index}))
  end

  @spec load(String.t()) :: {:ok, t()} | {:error, :missing | :corrupt}
  def load(dir) do
    case File.read(Path.join(dir, @file_name)) do
      {:ok, bin} -> decode(bin)
      {:error, _} -> {:error, :missing}
    end
  end

  defp decode(bin) do
    case :erlang.binary_to_term(bin) do
      {@format, %__MODULE__{} = index} -> {:ok, index}
      _ -> {:error, :corrupt}
    end
  rescue
    ArgumentError -> {:error, :corrupt}
  end

  # True when `mod` is `<App>` / `<App>.*` or `<App>Web` / `<App>Web.*`.
  defp app_module?(app, mod) do
    prefix = app |> Atom.to_string() |> Macro.camelize()

    case String.split(Atom.to_string(mod), ".") do
      ["Elixir", first | _] -> first in [prefix, prefix <> "Web"]
      _ -> false
    end
  end

  defp drop_module(index, mod) do
    {gone, kept} = Enum.split_with(index.functions, fn {_, f} -> f.module == mod end)
    gone = MapSet.new(gone, &elem(&1, 0))

    %{
      index
      | functions: Map.new(kept),
        edges: MapSet.reject(index.edges, fn {from, _} -> MapSet.member?(gone, from) end),
        modules: Map.delete(index.modules, mod)
    }
  end
end
