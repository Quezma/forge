defmodule Mix.Tasks.ExAtlas.Acceptance do
  @shortdoc "Runs the ex_atlas acceptance fixtures for this project"
  @moduledoc """
  Indexes the current project and checks `test/acceptance/<app>.jsonl` (in the ex_atlas repo)
  against it. Prints PASS/FAIL per fixture and fails when any fixture fails.

  With `--eval`, reads the held-out set `test/acceptance/<app>_eval.jsonl` instead and prints
  each query's rank (top 50, or "miss") plus n, hit@1, hit@5, hit@10 and MRR. A measurement:
  it never fails.
  """

  use Mix.Task

  alias ExAtlas.{Acceptance, Learnings}

  @impl Mix.Task
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, strict: [eval: :boolean])
    eval? = Keyword.get(opts, :eval, false)
    app = Mix.Project.config()[:app]
    file = if eval?, do: "#{app}_eval.jsonl", else: "#{app}.jsonl"
    path = Path.join([Learnings.repo_root(), "test", "acceptance", file])

    case Acceptance.load(path) do
      [] ->
        Mix.shell().info("no acceptance fixtures for #{app} (#{path})")

      fixtures ->
        root = File.cwd!()
        {:ok, index, report} = ExAtlas.Indexer.run(root, [])
        loaded = Acceptance.load_patterns(root)

        if report[:compile_error],
          do: Mix.shell().info("warning: compile error: #{report[:compile_error]}")

        if report[:degraded], do: Mix.shell().info("warning: index degraded (AST only)")
        Enum.each(loaded.warnings, &Mix.shell().info("warning: #{&1}"))

        if eval?, do: eval(index, loaded, fixtures), else: check(index, loaded, fixtures)
    end
  end

  defp eval(index, loaded, fixtures) do
    ranks =
      Enum.map(fixtures, fn f ->
        rank = Acceptance.eval_rank(index, loaded, f)
        Mix.shell().info("#{rank || "miss"}\t#{f["expect"]}\t#{f["args"]["query"]}")
        rank
      end)

    Mix.shell().info(Acceptance.format_summary(Acceptance.summary(ranks)))
  end

  defp check(index, loaded, fixtures) do
    failed =
      Enum.count(fixtures, fn f ->
        result = Acceptance.check(index, loaded, f)
        Mix.shell().info(Acceptance.format(f, result))
        match?({:fail, _}, result)
      end)

    if failed > 0,
      do: Mix.raise("#{failed} of #{length(fixtures)} acceptance fixtures failed")
  end
end
