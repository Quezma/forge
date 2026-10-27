defmodule ExAtlas.IndexerTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  alias ExAtlas.{Indexer, Source}

  @fixture Path.expand("../fixtures/sample_app", __DIR__)

  setup do
    root = Path.join(System.tmp_dir!(), "ex_atlas_#{System.unique_integer([:positive])}")
    File.cp_r!(@fixture, root)
    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, root: root}
  end

  defp run(root, opts \\ []) do
    ExUnit.CaptureIO.capture_io(:stderr, fn ->
      send(self(), {:result, Indexer.run(root, opts)})
    end)

    receive do
      {:result, r} -> r
    end
  end

  # No sleeping: change detection must hold within one mtime second.
  defp edit(root, rel, fun) do
    path = Path.join(root, rel)
    File.write!(path, fun.(File.read!(path)))
  end

  test "first run indexes all modules", %{root: root} do
    assert {:ok, index, report} = run(root)
    assert %{degraded: false, compile_error: nil} = report
    assert index.functions["SampleApp.Accounts.fetch/1"].area == "accounts"
    assert index.functions["SampleApp.Accounts.fetch/1"].file == "lib/sample_app/accounts.ex"
    assert index.functions["SampleAppWeb.UserController.show/1"].area == "web"

    kinds =
      for {id, f} <- index.functions, String.ends_with?(id, ".blank_to_nil/1"), do: f.kind

    assert Enum.sort(kinds) == [:def, :defp, :defp]
    assert File.exists?(Path.join(root, ".ex_atlas/index.etf"))
  end

  test "modules whose source is outside lib/ are not indexed", %{root: root} do
    File.mkdir_p!(Path.join(root, "extra"))

    File.write!(Path.join(root, "extra/vendored.ex"), """
    defmodule SampleApp.Vendored do
      def helper(x), do: x
    end
    """)

    edit(
      root,
      "mix.exs",
      &String.replace(&1, "deps: []", "elixirc_paths: [\"lib\", \"extra\"],\n      deps: []")
    )

    assert {:ok, index, report} = run(root, full: true)
    assert index.functions["SampleApp.Accounts.fetch/1"]
    refute Enum.any?(index.functions, fn {_, f} -> not String.starts_with?(f.file, "lib/") end)
    refute index.functions["SampleApp.Vendored.helper/1"]
    refute "extra/vendored.ex" in report.changed_files
  end

  test "a module that moves out of lib/ is dropped from an existing index", %{root: root} do
    File.write!(
      Path.join(root, "lib/vendored.ex"),
      "defmodule SampleApp.Vendored do\n  def helper(x), do: x\nend\n"
    )

    assert {:ok, index, _} = run(root)
    assert index.functions["SampleApp.Vendored.helper/1"]

    File.mkdir_p!(Path.join(root, "extra"))
    File.rename!(Path.join(root, "lib/vendored.ex"), Path.join(root, "extra/vendored.ex"))

    edit(
      root,
      "mix.exs",
      &String.replace(&1, "deps: []", "elixirc_paths: [\"lib\", \"extra\"],\n      deps: []")
    )

    assert {:ok, index, _} = run(root)
    refute index.functions["SampleApp.Vendored.helper/1"]
    assert {:ok, index, %{changed_files: []}} = run(root)
    refute index.functions["SampleApp.Vendored.helper/1"]
  end

  test "second run without changes reports nothing", %{root: root} do
    run(root)
    assert {:ok, _, %{changed_files: [], pattern_review_needed: false}} = run(root)
  end

  test "touching a file reindexes only it", %{root: root} do
    run(root)

    edit(root, "lib/sample_app/accounts.ex", fn src ->
      String.replace(src, ~r/end\s*\z/, "  def extra(x), do: x\nend\n")
    end)

    assert {:ok, index, report} = run(root)
    assert report.changed_files == ["lib/sample_app/accounts.ex"]
    assert report.pattern_review_needed
    assert index.functions["SampleApp.Accounts.extra/1"]
    # incremental: edges from other modules into Accounts survive
    assert {"SampleAppWeb.UserController.show/1", "SampleApp.Accounts.fetch/1"} in index.edges
  end

  test "syntax error degrades to AST entries and keeps other files", %{root: root} do
    run(root)

    edit(root, "lib/sample_app/accounts.ex", fn src ->
      String.replace(src, ~r/end\s*\z/, "  def extra(x), do: x\n  def broken(\nend\n")
    end)

    assert {:ok, index, report} = run(root)
    assert report.degraded
    assert is_binary(report.compile_error)
    assert report.changed_files == ["lib/sample_app/accounts.ex"]
    assert index.functions["SampleApp.Repo.get/2"]
    assert index.functions["SampleApp.Util.blank_to_nil/1"]
    assert index.degraded_files == ["lib/sample_app/accounts.ex"]

    # recovery: fixing the file replaces degraded entries
    edit(root, "lib/sample_app/accounts.ex", fn src ->
      String.replace(src, "  def broken(\n", "")
    end)

    assert {:ok, index, report} = run(root)
    refute report.degraded
    assert index.degraded_files == []
    assert index.functions["SampleApp.Accounts.fetch/1"].doc == "Fetch a user by id."
  end

  test "full reindex of a non-compiling project keeps source entries for every file", %{
    root: root
  } do
    edit(root, "lib/sample_app/accounts.ex", fn src ->
      String.replace(src, ~r/end\s*\z/, "  def broken(\nend\n")
    end)

    # Real projects have sources older than the index being built.
    for f <- Path.wildcard(Path.join(root, "lib/**/*.ex")), do: File.touch!(f, 1_600_000_000)

    assert {:ok, index, report} = run(root, full: true)
    assert report.degraded
    assert index.functions["SampleApp.Repo.get/2"]
    assert index.functions["SampleApp.Util.blank_to_nil/1"]
    assert index.functions["SampleAppWeb.UserController.show/1"]
  end

  test "Source.definitions keeps overloads and survives dynamic module names", %{root: root} do
    path = Path.join(root, "lib/y.ex")

    File.write!(path, """
    defmodule C.D do
      def f(a), do: a
      def f(a, b), do: {a, b}
      def f(:x, b), do: b
    end
    """)

    assert [{:f, 1}, {:f, 2}] =
             path |> Source.definitions() |> Enum.map(&{&1.name, &1.arity}) |> Enum.sort()

    File.write!(path, "defmodule __MODULE__.Foo do\n def a, do: 1\nend\n")
    assert Source.definitions(path) == []
  end

  test "Source.definitions handles guards, defaults and kinds", %{root: root} do
    path = Path.join(root, "lib/x.ex")

    File.write!(path, """
    defmodule A.B do
      def f(a, b \\\\ 1) when is_integer(a), do: {a, b}
      defp g(x), do: x
      defmacro m(), do: nil
      defmacrop n(a, b, c), do: {a, b, c}
    end
    """)

    assert [
             %{module: A.B, name: :f, arity: 2, kind: :def, line: 2},
             %{name: :g, arity: 1, kind: :defp},
             %{name: :m, arity: 0, kind: :defmacro},
             %{name: :n, arity: 3, kind: :defmacrop}
           ] = Source.definitions(path)
  end
end
