defmodule ExAtlas.InstallTest do
  use ExUnit.Case, async: true

  @start "<!-- ex_atlas:start -->"
  @end_ "<!-- ex_atlas:end -->"

  setup do
    dir = Path.join(System.tmp_dir!(), "ex_atlas_install_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  defp install(dir),
    do: ExUnit.CaptureIO.capture_io(fn -> Mix.Tasks.ExAtlas.Install.run([dir]) end)

  test "creates .ex_atlas/.gitignore that ignores the index but not patterns", %{dir: dir} do
    install(dir)
    assert File.read!(Path.join(dir, ".ex_atlas/.gitignore")) == "/*\n!/.gitignore\n!/patterns/\n"

    {_, 0} = System.cmd("git", ["init", "-q"], cd: dir)
    File.mkdir_p!(Path.join(dir, ".ex_atlas/patterns"))

    assert {_, 0} = System.cmd("git", ["check-ignore", "-q", ".ex_atlas/index.etf"], cd: dir)

    assert {_, 1} =
             System.cmd("git", ["check-ignore", "-q", ".ex_atlas/patterns/x.json"], cd: dir)
  end

  test "is idempotent: one marker block after two runs", %{dir: dir} do
    install(dir)
    install(dir)
    agents = File.read!(Path.join(dir, "AGENTS.md"))
    assert length(String.split(agents, @start)) == 2
    assert length(String.split(agents, @end_)) == 2
    assert agents =~ "context_for_task"
  end

  test "keeps existing AGENTS.md content and prints the mcp command", %{dir: dir} do
    File.write!(Path.join(dir, "AGENTS.md"), "# Mine\n\nkeep me\n")
    out = install(dir)
    agents = File.read!(Path.join(dir, "AGENTS.md"))
    assert agents =~ "# Mine\n\nkeep me"
    assert agents =~ @start
    assert out =~ "claude mcp add ex_atlas -- mix ex_atlas.server"
  end

  test "replaces a hand-edited block and keeps content before and after", %{dir: dir} do
    File.write!(
      Path.join(dir, "AGENTS.md"),
      "before\n\n#{@start}\nhand edited\n#{@end_}\n\nafter\n"
    )

    install(dir)
    agents = File.read!(Path.join(dir, "AGENTS.md"))
    refute agents =~ "hand edited"
    assert agents =~ "before\n\n#{@start}"
    assert agents =~ "#{@end_}\n\nafter"
    assert agents =~ "context_for_task"
    refute agents =~ "record_learning"
  end

  test "warns when CLAUDE.md exists without @AGENTS.md", %{dir: dir} do
    File.write!(Path.join(dir, "CLAUDE.md"), "# rules\n")
    assert install(dir) =~ "@AGENTS.md"

    File.write!(Path.join(dir, "CLAUDE.md"), "@AGENTS.md\n")
    refute install(dir) =~ "warning"
  end

  test "no warning without a CLAUDE.md, and the output mentions mix ex_atlas.index", %{dir: dir} do
    out = install(dir)
    refute out =~ "warning"
    assert out =~ "mix ex_atlas.index"
  end

  test "raises for a non-existent directory", %{dir: dir} do
    missing = Path.join(dir, "nope")
    assert_raise Mix.Error, ~r/not a directory/, fn -> install(missing) end
    refute File.exists?(missing)
  end
end
