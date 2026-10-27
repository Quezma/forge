defmodule Mix.Tasks.ExAtlas.Server do
  @shortdoc "Runs the ex_atlas MCP server on stdio"
  @moduledoc """
  Serves newline-delimited JSON-RPC (MCP) on stdio. Startup does no indexing or compiling:
  the saved index is loaded (or built when missing) on the first tool call that needs it.
  Stdout carries only JSON-RPC messages; everything else goes to stderr.
  """

  use Mix.Task

  alias ExAtlas.{Indexer, MCP}

  @impl Mix.Task
  def run(_args) do
    Mix.shell(Mix.Shell.Quiet)
    :ok = logger_to_stderr()
    :ok = preload()

    # Raw bytes in and out, so UTF-8 JSON passes through untouched.
    :io.setopts(:standard_io, binary: true, encoding: :latin1)

    root = File.cwd!()
    dir = Path.join(root, ".ex_atlas")
    loop(%{root: root, dir: dir, index: nil, loader: loader(root, dir), initialized?: false})
  end

  # Modules load lazily, so after an archive reinstall a running server would mix old and
  # new code. Loading them all now pins it to one version. As an archive the app is not
  # loaded yet; inside the ex_atlas project it already is.
  defp preload do
    case Application.load(:ex_atlas) do
      :ok -> :ok
      {:error, {:already_loaded, :ex_atlas}} -> :ok
    end

    Code.ensure_all_loaded(Application.spec(:ex_atlas, :modules))
  end

  defp loader(root, dir) do
    app = Mix.Project.config()[:app]

    fn ->
      case ExAtlas.Index.load(dir) do
        {:ok, %ExAtlas.Index{app: ^app} = index} ->
          index

        _ ->
          {:ok, index, _report} = quiet(fn -> Indexer.run(root, []) end)
          index
      end
    end
  end

  @doc false
  # logger_std_h cannot change its type in place, and writes to `user` regardless of
  # the group leader, so the default handler is replaced by one on standard_error.
  def logger_to_stderr do
    {:ok, %{module: module, config: config} = handler} = :logger.get_handler_config(:default)

    rest =
      handler
      |> Map.drop([:id, :module, :config])
      |> Map.put(:config, %{config | type: :standard_error})

    with :ok <- :logger.remove_handler(:default) do
      :logger.add_handler(:default, module, rest)
    end
  end

  # Redirects the group leader so stray IO.puts/Mix output during indexing hits stderr.
  # It does not cover Logger, which logger_to_stderr/0 handles.
  defp quiet(fun) do
    leader = Process.group_leader()
    Process.group_leader(self(), Process.whereis(:standard_error))

    try do
      fun.()
    after
      Process.group_leader(self(), leader)
    end
  end

  defp loop(state) do
    case IO.binread(:stdio, :line) do
      :eof ->
        :ok

      {:error, _} ->
        :ok

      line ->
        case String.trim(line) do
          "" ->
            loop(state)

          trimmed ->
            {reply, state} = MCP.handle(trimmed, state)
            if reply, do: IO.binwrite(:stdio, reply <> "\n")
            loop(state)
        end
    end
  end
end
