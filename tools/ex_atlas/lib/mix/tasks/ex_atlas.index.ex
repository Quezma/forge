defmodule Mix.Tasks.ExAtlas.Index do
  @shortdoc "Indexes the current project and prints a JSON report"
  @moduledoc """
  Compiles the project and updates `.ex_atlas/`. Pass `--full` to rebuild from scratch.
  """

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, strict: [full: :boolean])
    {:ok, _index, report} = ExAtlas.Indexer.run(File.cwd!(), opts)
    IO.puts(JSON.encode!(report))
  end
end
