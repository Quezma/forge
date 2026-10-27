defmodule ExAtlas.IndexTest do
  use ExUnit.Case, async: false

  import ExAtlas.CompileHelper
  alias ExAtlas.{Beam, Index}

  @accounts "defmodule Fx.Accounts do\n  def fetch(id), do: id\nend\n"
  @controller "defmodule FxWeb.UserController do\n  def show(id), do: Fx.Accounts.fetch(id)\nend\n"
  @controller2 "defmodule FxWeb.UserController do\n  def show(id), do: id\nend\n"

  defp info(src, file) do
    {:ok, info} = Beam.read(compile(src, true, file))
    info
  end

  defp put(index, src, file, mtime \\ 1) do
    Index.put_module(index, info(src, file), "ebin/#{file}.beam", mtime, fn _ -> false end)
  end

  defp build do
    Index.new(:fx)
    |> put(@accounts, "lib/fx/accounts/x.ex")
    |> put(@controller, "lib/fx_web/user_controller.ex")
    |> Index.finalize()
  end

  test "computes callers, areas and area edges" do
    idx = build()
    assert Index.id({Fx.Accounts, :fetch, 1}) == "Fx.Accounts.fetch/1"
    assert idx.functions["Fx.Accounts.fetch/1"].callers == 1
    assert idx.functions["Fx.Accounts.fetch/1"].area == "accounts"
    assert idx.functions["FxWeb.UserController.show/1"].area == "web"
    assert Index.callers_of(idx, "Fx.Accounts.fetch/1") == ["FxWeb.UserController.show/1"]
    assert Index.area_edges(idx) == %{{"web", "accounts"} => 1}
    assert idx.modules[Fx.Accounts].file == "lib/fx/accounts/x.ex"
  end

  test "replacing a module drops its old edges" do
    idx = build() |> put(@controller2, "lib/fx_web/user_controller.ex", 2) |> Index.finalize()
    assert idx.functions["Fx.Accounts.fetch/1"].callers == 0
    assert Index.area_edges(idx) == %{}
  end

  test "drop_beam removes the module's functions and edges" do
    idx =
      build() |> Index.drop_beam("ebin/lib/fx_web/user_controller.ex.beam") |> Index.finalize()

    refute Map.has_key?(idx.functions, "FxWeb.UserController.show/1")
    assert idx.functions["Fx.Accounts.fetch/1"].callers == 0
    refute Map.has_key?(idx.modules, FxWeb.UserController)
  end

  @tag :tmp_dir
  test "save/load round-trips; load of empty dir is :missing", %{tmp_dir: dir} do
    idx = build()
    assert Index.load(dir) == {:error, :missing}
    assert Index.save(idx, dir) == :ok
    assert Index.load(dir) == {:ok, idx}
  end

  test "edges survive until their target is indexed" do
    idx =
      Index.new(:fx)
      |> put(@controller, "lib/fx_web/user_controller.ex")
      |> Index.finalize()
      |> put(@accounts, "lib/fx/accounts/x.ex")
      |> Index.finalize()

    assert idx.functions["Fx.Accounts.fetch/1"].callers == 1
  end

  test "edges to non-app modules are not stored, namespace is segment-bounded" do
    src =
      "defmodule Fx.A do\n  def a, do: {Enum.map([], & &1), Fxa.B.c(), Fx.Z.z(), FxWeb.Q.q()}\nend\n"

    idx = Index.new(:fx) |> put(src, "lib/fx/a.ex")
    assert idx.edges |> Enum.map(&elem(&1, 1)) |> Enum.sort() == ["Fx.Z.z/0", "FxWeb.Q.q/0"]
  end

  @tag :tmp_dir
  test "save creates .gitignore next to the index", %{tmp_dir: dir} do
    Index.save(Index.new(:fx), dir)
    assert File.read!(Path.join(dir, ".gitignore")) == Index.gitignore()
  end

  @tag :tmp_dir
  test "load of an index saved without a format version is :corrupt", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "index.etf"), :erlang.term_to_binary(Index.new(:fx)))
    assert Index.load(dir) == {:error, :corrupt}
  end

  @tag :tmp_dir
  test "load of an index saved by an older format version is :corrupt", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "index.etf"), :erlang.term_to_binary({1, Index.new(:fx)}))
    assert Index.load(dir) == {:error, :corrupt}
  end

  @tag :tmp_dir
  test "load of a corrupt file is :corrupt", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "index.etf"), "garbage")
    assert Index.load(dir) == {:error, :corrupt}
  end
end
