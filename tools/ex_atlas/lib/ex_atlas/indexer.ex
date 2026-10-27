defmodule ExAtlas.Indexer do
  @moduledoc """
  Compiles a Mix project and incrementally updates its index from the beams.

  If compilation fails the stored index is kept and files edited since the last
  successful run are re-read from source only (degraded mode).
  """

  alias ExAtlas.{Beam, Index, Source}

  @index_dir ".ex_atlas"

  @type report :: %{
          changed_files: [String.t()],
          degraded: boolean(),
          compile_error: String.t() | nil,
          pattern_review_needed: boolean()
        }

  @spec run(String.t(), keyword()) :: {:ok, Index.t(), report()}
  def run(project_root, opts \\ []) do
    root = Path.expand(project_root)

    if Mix.Project.get() && File.cwd!() == root do
      do_run(root, opts)
    else
      Mix.Project.in_project(:ex_atlas_target, root, fn _ -> do_run(root, opts) end)
    end
  end

  defp do_run(root, opts) do
    app = Mix.Project.config()[:app]
    dir = Path.join(root, @index_dir)
    started = System.os_time(:second)
    sources = hash_sources()
    index = if opts[:full], do: Index.new(app), else: load(dir, app)

    {index, report} =
      case compile() do
        :ok -> update_from_beams(index, root, started, sources)
        {:error, message} -> degrade(index, message, sources)
      end

    Index.save(index, dir)
    {:ok, index, report}
  end

  defp load(dir, app) do
    case Index.load(dir) do
      {:ok, %Index{app: ^app} = index} -> index
      _ -> Index.new(app)
    end
  end

  defp compile do
    paths = :code.get_path()
    leader = Process.group_leader()
    # Mix prints progress to stdout, which must stay clean for the JSON report.
    {:ok, sink} = StringIO.open("")
    Process.group_leader(self(), sink)

    try do
      # Tasks run once per project module; temp copies share one, so forget earlier runs.
      Mix.Task.clear()

      case Mix.Task.rerun("compile", ["--return-errors"]) do
        {:error, diags} -> {:error, format(diags)}
        _ -> :ok
      end
    rescue
      e -> {:error, Exception.message(e)}
    after
      # Compiling another project prunes code paths, including this archive's own.
      Enum.each(paths -- :code.get_path(), &:code.add_pathz/1)
      Process.group_leader(self(), leader)
      StringIO.close(sink)
    end
  end

  defp format(diags) do
    case Enum.filter(diags, &(&1.severity == :error)) do
      [] -> "compilation failed"
      errors -> Enum.map_join(errors, "\n", &"#{&1.file}:#{inspect(&1.position)}: #{&1.message}")
    end
  end

  defp update_from_beams(index, root, started, sources) do
    beams = Path.wildcard(Path.join(Mix.Project.compile_path(), "*.beam"))
    present = MapSet.new(beams)
    dir_exists? = &File.dir?(Path.join(root, &1))
    stale = MapSet.new(index.degraded_files)

    # Degraded entries come from source; drop them and rebuild from the beams.
    index = drop_files(index, stale)

    gone = Enum.reject(Map.keys(index.beams), &MapSet.member?(present, &1))
    beam_files = Map.new(index.modules, fn {_, m} -> {m.beam, m.file} end)
    gone_files = for b <- gone, f = beam_files[b], f, do: f
    index = Enum.reduce(gone, index, &Index.drop_beam(&2, &1))

    {index, files} =
      Enum.reduce(beams, {index, gone_files}, fn beam, {idx, files} ->
        bin = File.read!(beam)
        # A content hash, not mtime: beams rewritten within the same second must still register.
        hash = :erlang.md5(bin)
        forced? = beam_files[beam] in stale

        if Map.get(idx.beams, beam) == hash and not forced? do
          {idx, files}
        else
          with {:ok, info} <- Beam.read(bin),
               info = %{info | file: Path.relative_to(info.file, File.cwd!())} do
            if String.starts_with?(info.file, "lib/") do
              {Index.put_module(idx, info, beam, hash, dir_exists?), [info.file | files]}
            else
              # Deps and generated code are not project code. Drop any old entries and
              # remember the hash so the beam is not re-read every run.
              idx = Index.drop_beam(idx, beam)
              {%{idx | beams: Map.put(idx.beams, beam, hash)}, files}
            end
          else
            _ -> {idx, files}
          end
        end
      end)

    index = %{Index.finalize(index) | degraded_files: [], built_at: started, sources: sources}
    changed = files |> Enum.concat(stale) |> Enum.uniq() |> Enum.sort()
    {index, report(changed, false, nil)}
  end

  defp degrade(index, message, sources) do
    stale =
      for {path, hash} <- sources, changed_since_index?(index, path, hash), do: path

    dir_exists? = &File.dir?(&1)
    index = drop_files(index, MapSet.new(stale))

    index =
      Enum.reduce(stale, index, fn path, idx ->
        area = ExAtlas.Area.of(path, idx.app, dir_exists?)

        functions =
          for d <- Source.definitions(path), into: %{} do
            id = Index.id({d.module, d.name, d.arity})

            {id,
             %{
               id: id,
               module: d.module,
               name: d.name,
               arity: d.arity,
               kind: d.kind,
               file: path,
               line: d.line,
               doc: nil,
               doc_rest: nil,
               spec: nil,
               area: area,
               callers: 0
             }}
          end

        %{idx | functions: Map.merge(idx.functions, functions)}
      end)

    index = %{
      Index.finalize(index)
      | degraded_files: Enum.uniq(index.degraded_files ++ stale)
    }

    {index, report(Enum.sort(stale), true, message)}
  end

  # Hashes taken before compiling, so edits racing the compile are seen next run.
  defp hash_sources do
    Map.new(Path.wildcard("lib/**/*.ex"), &{&1, :erlang.md5(File.read!(&1))})
  end

  # Content hash, not mtime (1s resolution). Without a stored hash the file was never indexed.
  defp changed_since_index?(index, path, hash), do: index.sources[path] != hash

  # Removes functions (and their outgoing edges) defined in the given files.
  defp drop_files(index, files) do
    if MapSet.size(files) == 0 do
      index
    else
      {gone, kept} = Enum.split_with(index.functions, fn {_, f} -> f.file in files end)
      ids = MapSet.new(gone, &elem(&1, 0))

      %{
        index
        | functions: Map.new(kept),
          edges: MapSet.reject(index.edges, fn {from, _} -> from in ids end)
      }
    end
  end

  defp report(changed, degraded, error) do
    %{
      changed_files: changed,
      degraded: degraded,
      compile_error: error,
      pattern_review_needed: Enum.any?(changed, &String.starts_with?(&1, "lib/"))
    }
  end
end
