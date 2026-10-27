defmodule ExAtlas.ContextTest do
  use ExUnit.Case, async: true

  alias ExAtlas.{Context, Index}

  defp fun(id, area, extra \\ %{}) do
    Map.merge(
      %{id: id, area: area, kind: :def, spec: "@spec x() :: :ok", doc: "doc", callers: 0},
      extra
    )
  end

  defp entry(id, text, extra \\ %{}),
    do: Map.merge(%{"id" => id, "kind" => "rule", "text" => text, "evidence" => ["A.a/0"]}, extra)

  setup do
    functions =
      for f <- [
            fun("A.a/0", "development"),
            fun("P.pub/0", "platform", %{callers: 2}),
            fun("P.unused/0", "platform"),
            fun("P.priv/0", "platform", %{kind: :defp, callers: 5}),
            fun("W.w/0", "web")
          ],
          into: %{},
          do: {f.id, f}

    index = %Index{
      app: :fx,
      functions: functions,
      edges:
        MapSet.new([
          {"A.a/0", "P.pub/0"},
          {"A.a/0", "P.priv/0"},
          {"W.w/0", "A.a/0"},
          {"A.a/0", "W.w/0"},
          {"W.w/0", "W.w/0"}
        ])
    }

    loaded = %{
      areas: %{
        "_global" => %{"entries" => [entry("g-1", "global rule")]},
        "development" => %{
          "entries" => [
            entry("d-1", "dev rule"),
            entry("d-2", "gone", %{"evidence" => ["Nope.x/0"]})
          ]
        },
        "platform" => %{
          "entries" => [
            entry("p-1", "ext", %{"audience" => "external"}),
            entry("p-2", "int", %{"audience" => "internal"}),
            entry("p-3", "absent audience")
          ]
        }
      },
      warnings: ["w"]
    }

    {:ok, index: index, loaded: loaded}
  end

  test "includes platform neighbour but not web", %{index: i, loaded: l} do
    r = Context.build(i, l, "do it", ["development"], [])
    assert r.task == "do it"
    assert Map.keys(r.neighbours) == ["platform"]
    assert [%{"id" => "g-1"}] = r.global
    assert r.warnings == ["w"]
    assert %{"platform" => %{api: [%{id: "P.pub/0"}], entries: [%{"id" => "p-1"}]}} = r.neighbours
    assert is_integer(r.tokens)
    assert JSON.encode!(r)
  end

  test "budget truncates neighbours", %{index: i, loaded: l} do
    r = Context.build(i, l, "t", ["development"], budget: 50)
    assert r.truncated == ["platform"]
    assert r.neighbours == %{}
    assert r.over_budget == true
  end

  test "stale entries are flagged", %{index: i, loaded: l} do
    r = Context.build(i, l, "t", ["development"], [])
    [_, d2] = r.areas["development"].entries
    assert d2["stale"] == true
    assert [%{area: "development", entry_id: "d-2"}] = r.stale
  end

  test "unknown and empty areas", %{index: i, loaded: l} do
    r = Context.build(i, l, "t", ["nope", "web"], [])
    assert r.unknown_areas == ["nope"]
    assert "web" in r.known_areas and r.known_areas == Enum.sort(r.known_areas)
    assert r.areas == %{"web" => %{entries: []}}
    refute Map.has_key?(r, :over_budget)
  end

  test "known_areas is absent when every area is known", %{index: i, loaded: l} do
    refute Map.has_key?(Context.build(i, l, "t", ["web"], []), :known_areas)
  end

  test "_global is not a nameable area", %{index: i, loaded: l} do
    r = Context.build(i, l, "t", ["_global"], [])
    assert r.unknown_areas == ["_global"]
    assert r.areas == %{}
  end

  test "stale only reports emitted entries", %{index: i, loaded: l} do
    l =
      put_in(l.areas["platform"]["entries"], [
        entry("p-1", "ext", %{"audience" => "external"}),
        entry("p-2", "int", %{"evidence" => ["Nope.x/0"]})
      ])

    r = Context.build(i, l, "t", ["development"], [])
    assert [%{entry_id: "d-2"}] = r.stale
  end

  defp multi(extra_funs, edges) do
    funs = [fun("A.a/0", "development") | extra_funs]
    index = %Index{app: :fx, functions: Map.new(funs, &{&1.id, &1}), edges: MapSet.new(edges)}

    loaded = %{
      areas: %{
        "p" => %{
          "entries" => [entry("p-1", String.duplicate("x", 400), %{"audience" => "external"})]
        }
      },
      warnings: []
    }

    {index, loaded}
  end

  test "budget between sizes drops only the lowest-ranked neighbour" do
    {i, l} =
      multi(
        [
          fun("P.f/0", "p", %{callers: 1}),
          fun("Q.f/0", "q", %{callers: 1}),
          fun("Q.g/0", "q", %{callers: 1})
        ],
        [{"A.a/0", "P.f/0"}, {"A.a/0", "Q.f/0"}, {"A.a/0", "Q.g/0"}]
      )

    full = Context.build(i, l, "t", ["development"], [])
    assert Map.keys(full.neighbours) == ["p", "q"]
    r = Context.build(i, l, "t", ["development"], budget: full.tokens - 1)
    assert r.truncated == ["p"] or r.truncated == ["q"]
    assert r.truncated == ["p"]
    assert Map.keys(r.neighbours) == ["q"]
    refute Map.has_key?(r, :over_budget)
  end

  test "equal weights drop the greater name first" do
    {i, l} =
      multi(
        [fun("P.f/0", "p", %{callers: 1}), fun("Q.f/0", "q", %{callers: 1})],
        [{"A.a/0", "P.f/0"}, {"A.a/0", "Q.f/0"}]
      )

    full = Context.build(i, l, "t", ["development"], [])
    r = Context.build(i, l, "t", ["development"], budget: full.tokens - 1)
    assert r.truncated == ["q"]
  end

  test "api is capped at 15 and ordered by callers" do
    funs = for n <- 1..20, do: fun("B.f#{n}/0", "b", %{callers: n})
    {i, l} = multi(funs, for(f <- funs, do: {"A.a/0", f.id}))
    r = Context.build(i, l, "t", ["development"], [])
    ids = Enum.map(r.neighbours["b"].api, & &1.id)
    assert length(ids) == 15
    assert hd(ids) == "B.f20/0"
    assert List.last(ids) == "B.f6/0"
  end
end
