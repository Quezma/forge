defmodule ExAtlas.Context do
  @moduledoc """
  Assembles the context an agent needs before implementing a task: global rules,
  the patterns of the named areas, and a budgeted one-hop view of neighbouring areas.
  """

  alias ExAtlas.{Index, Patterns}

  @default_budget 8000
  @excluded ~w(core web other)
  @max_api 15

  @spec build(Index.t(), map(), String.t(), [String.t()], keyword()) :: map()
  def build(index, loaded, task, areas, opts \\ []) do
    budget = Keyword.get(opts, :budget, @default_budget)
    stale = Patterns.stale(loaded, index)
    flagged = MapSet.new(stale, &{&1.area, &1.entry_id})
    mark = fn area, entries -> Enum.map(entries, &flag(&1, area, flagged)) end

    known =
      MapSet.new(Enum.map(Map.values(index.functions), & &1.area) ++ Map.keys(loaded.areas))
      |> MapSet.delete("_global")

    {named, unknown} = Enum.split_with(Enum.uniq(areas), &MapSet.member?(known, &1))

    named_areas =
      Map.new(named, fn a -> {a, %{entries: mark.(a, entries(loaded, a))}} end)

    ranked = neighbours(index, loaded, named, mark)

    base = %{
      task: task,
      global: mark.("_global", entries(loaded, "_global")),
      areas: named_areas,
      warnings: loaded.warnings,
      unknown_areas: unknown
    }

    base = if unknown == [], do: base, else: Map.put(base, :known_areas, Enum.sort(known))

    finish(base, ranked, [], stale, budget)
  end

  defp finish(base, ranked, truncated, stale, budget) do
    kept = Map.new(ranked)
    result = measure(base, kept, truncated, stale)

    cond do
      result.tokens <= budget ->
        result

      ranked == [] ->
        # over_budget only when global + named areas alone exceed the budget
        if measure(base, %{}, [], stale).tokens > budget,
          do: Map.put(result, :over_budget, true),
          else: result

      true ->
        {name, _} = List.last(ranked)
        finish(base, List.delete_at(ranked, -1), truncated ++ [name], stale, budget)
    end
  end

  # tokens approximates the final result size, including its own digits
  defp measure(base, kept, truncated, stale) do
    emitted =
      MapSet.new(
        for {area, entries} <-
              [{"_global", base.global}] ++
                Enum.map(base.areas, fn {a, v} -> {a, v.entries} end) ++
                Enum.map(kept, fn {a, v} -> {a, v.entries} end),
            e <- entries,
            do: {area, e["id"]}
      )

    r =
      Map.merge(base, %{
        neighbours: kept,
        truncated: Enum.sort(truncated),
        stale: Enum.filter(stale, &MapSet.member?(emitted, {&1.area, &1.entry_id})),
        tokens: 0
      })

    t = estimate(r)
    %{r | tokens: estimate(%{r | tokens: t})}
  end

  defp estimate(r), do: div(byte_size(JSON.encode!(r)), 4)

  defp entries(loaded, area), do: get_in(loaded.areas, [area, "entries"]) || []

  defp flag(e, area, flagged),
    do: if(MapSet.member?(flagged, {area, e["id"]}), do: Map.put(e, "stale", true), else: e)

  # Returns [{area, %{api:, entries:}}] ordered best-first (most edges; ties by name ascending).
  defp neighbours(index, loaded, named, mark) do
    named_set = MapSet.new(named)
    counts = Index.area_edges(index)

    weights =
      Enum.reduce(counts, %{}, fn {{a, b}, n}, acc ->
        case {a in named_set, b in named_set} do
          {true, false} -> Map.update(acc, b, n, &(&1 + n))
          {false, true} -> Map.update(acc, a, n, &(&1 + n))
          _ -> acc
        end
      end)

    called_from_named =
      for {from, to} <- index.edges,
          index.functions[from] && index.functions[from].area in named_set,
          into: MapSet.new(),
          do: to

    weights
    |> Enum.reject(fn {a, _} -> a in @excluded end)
    |> Enum.sort_by(fn {a, n} -> {-n, a} end)
    |> Enum.map(fn {a, _} ->
      api =
        index.functions
        |> Map.values()
        |> Enum.filter(
          &(&1.area == a and &1.kind == :def and &1.callers > 0 and
              MapSet.member?(called_from_named, &1.id))
        )
        |> Enum.sort_by(&{-&1.callers, &1.id})
        |> Enum.take(@max_api)
        |> Enum.map(&%{id: &1.id, spec: &1.spec, doc: &1.doc})

      external =
        Enum.filter(entries(loaded, a), &(Map.get(&1, "audience", "internal") == "external"))

      {a, %{api: api, entries: mark.(a, external)}}
    end)
  end
end
