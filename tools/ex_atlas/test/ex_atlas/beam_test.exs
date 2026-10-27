defmodule ExAtlas.BeamTest do
  use ExUnit.Case, async: false

  alias ExAtlas.Beam

  @source """
  defmodule Fx.Accounts do
    alias Fx.Repo
    import Enum, only: [map: 2]
    @doc "Fetch a user.\\n\\nMore text."
    @spec fetch(term) :: term
    def fetch(id), do: Repo.get(:user, id) |> helper() |> then(&Repo.preload(&1, []))
    defp helper(x), do: map([x], &String.trim/1)
  end
  """

  import ExAtlas.CompileHelper

  setup_all do
    {:ok, beam: compile(@source, true)}
  end

  test "reads definitions with docs, specs and lines", %{beam: beam} do
    assert {:ok, %{module: Fx.Accounts, definitions: defs}} = Beam.read(beam)

    assert %{
             name: :fetch,
             arity: 1,
             kind: :def,
             line: 6,
             doc: "Fetch a user.",
             doc_rest: "More text.",
             spec: "fetch(term()) :: term()"
           } in defs

    assert Enum.any?(defs, &match?(%{name: :helper, arity: 1, kind: :defp, line: 7}, &1))
  end

  test "collects calls", %{beam: beam} do
    assert {:ok, %{calls: calls}} = Beam.read(beam)

    for call <- [
          {{:fetch, 1}, {Fx.Repo, :get, 2}},
          {{:fetch, 1}, {Fx.Repo, :preload, 2}},
          {{:fetch, 1}, {Fx.Accounts, :helper, 1}},
          {{:helper, 1}, {Enum, :map, 2}},
          {{:helper, 1}, {String, :trim, 1}}
        ] do
      assert call in calls
    end

    refute Enum.any?(calls, &match?({_, {String, :trim, 0}}, &1))
    assert calls == Enum.uniq(calls)
  end

  test "records local captures as call edges" do
    beam =
      compile(
        "defmodule Fx.Caps do\n  def run(l), do: Enum.map(l, &helper/1)\n  defp helper(x), do: x\nend\n",
        true
      )

    assert {:ok, %{calls: calls}} = Beam.read(beam)
    assert {{:run, 1}, {Fx.Caps, :helper, 1}} in calls
  end

  test "returns :no_debug_info when compiled without debug info" do
    beam = compile("defmodule Fx.NoDebug do\n  def a, do: 1\nend\n", false)
    assert Beam.read(beam) == {:error, :no_debug_info}
  end
end
