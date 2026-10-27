defmodule ExAtlas.Acceptance do
  @moduledoc """
  Runs acceptance fixtures (`{tool, args, expect, top_k}`) against an index.

  Calls `Search` / `Context` directly so the project's usage log stays clean.
  """

  alias ExAtlas.{Context, Patterns, Search}

  @spec load(Path.t()) :: [map()]
  def load(path) do
    case File.read(path) do
      {:ok, text} ->
        text
        |> String.split("\n")
        |> Enum.reject(&(String.trim(&1) == ""))
        |> Enum.map(&JSON.decode!/1)

      {:error, _} ->
        []
    end
  end

  @spec load_patterns(Path.t()) :: map()
  def load_patterns(root), do: Patterns.load_all(Path.join(root, ".ex_atlas"))

  @spec check(ExAtlas.Index.t(), map(), map()) ::
          {:pass, pos_integer() | nil} | {:fail, [String.t()]}
  def check(_index, _loaded, %{"expect" => e}) when not is_binary(e),
    do: {:fail, ["malformed fixture: expect must be a string"]}

  def check(index, loaded, %{"tool" => "find_reusable", "args" => %{"query" => q}} = f)
      when is_binary(q) do
    top_k = f["top_k"] || 5

    results =
      Search.find(index, Patterns.purposes(loaded), q,
        limit: top_k,
        pattern_text: Patterns.pattern_text(loaded)
      )

    rank =
      Enum.find_index(
        results,
        &hit?(f["expect"], [&1.id | Enum.map(&1.copies, fn c -> c.id end)])
      )

    case rank do
      nil -> {:fail, Enum.map(results, & &1.id)}
      i -> {:pass, i + 1}
    end
  end

  def check(
        index,
        loaded,
        %{"tool" => "context_for_task", "args" => %{"task" => t, "areas" => a}} = f
      )
      when is_binary(t) and is_list(a) do
    r = Context.build(index, loaded, t, a)

    ids =
      Enum.concat([
        r.global,
        Enum.flat_map(r.areas, fn {_, v} -> v.entries end),
        Enum.flat_map(r.neighbours, fn {_, v} -> v.entries end)
      ])
      |> Enum.map(& &1["id"])

    if f["expect"] in ids, do: {:pass, nil}, else: {:fail, []}
  end

  def check(_index, _loaded, %{"tool" => tool})
      when tool in ["find_reusable", "context_for_task"],
      do: {:fail, ["malformed fixture args for #{tool}"]}

  def check(_index, _loaded, %{"tool" => tool}), do: {:fail, ["unknown tool: #{tool}"]}

  # exact id, or (no module part in `expect`) a "."-suffix of any id
  defp hit?(expect, ids) do
    suffix? = not String.contains?(expect, ".")
    Enum.any?(ids, &(&1 == expect or (suffix? and String.ends_with?(&1, "." <> expect))))
  end

  @eval_depth 50

  @doc "Rank of `expect` within the top #{@eval_depth} (ignores the fixture's `top_k`), or `nil`."
  @spec eval_rank(ExAtlas.Index.t(), map(), map()) :: pos_integer() | nil
  def eval_rank(index, loaded, fixture) do
    case check(index, loaded, Map.put(fixture, "top_k", @eval_depth)) do
      {:pass, rank} -> rank
      {:fail, _} -> nil
    end
  end

  @doc "hit@1/5/10 counts and MRR over eval ranks (`nil` = miss, contributes 0)."
  @spec summary([pos_integer() | nil]) :: map()
  def summary(ranks) do
    n = length(ranks)
    hits = fn k -> Enum.count(ranks, &(&1 && &1 <= k)) end
    rr = ranks |> Enum.map(&if(&1, do: 1 / &1, else: 0.0)) |> Enum.sum()

    %{
      n: n,
      hit1: hits.(1),
      hit5: hits.(5),
      hit10: hits.(10),
      mrr: if(n == 0, do: 0.0, else: rr / n)
    }
  end

  @spec format_summary(map()) :: String.t()
  def format_summary(%{n: n} = s) do
    rate = fn c -> :erlang.float_to_binary(if(n == 0, do: 0.0, else: c / n), decimals: 2) end

    "n=#{n} " <>
      Enum.map_join([1, 5, 10], " ", fn k ->
        c = Map.fetch!(s, :"hit#{k}")
        "hit@#{k}=#{c} (#{rate.(c)})"
      end) <> " MRR=#{:erlang.float_to_binary(s.mrr, decimals: 3)}"
  end

  @spec format(map(), {:pass, term()} | {:fail, [String.t()]}) :: String.t()
  def format(f, {:pass, nil}), do: "PASS #{f["tool"]} #{label(f)}"
  def format(f, {:pass, rank}), do: "PASS #{f["tool"]} #{label(f)} → rank #{rank}"

  def format(f, {:fail, top}),
    do:
      "FAIL #{f["tool"]} #{label(f)} → expected #{f["expect"]}, top: #{top |> Enum.take(3) |> Enum.join(", ")}"

  defp label(%{"args" => %{"query" => q}}), do: q
  defp label(%{"args" => %{"task" => t}}), do: t
  defp label(_), do: "(malformed args)"
end
