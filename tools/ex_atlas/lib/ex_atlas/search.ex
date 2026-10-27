defmodule ExAtlas.Search do
  @moduledoc """
  Ranked natural-language search over indexed functions ("does this already exist?").

  Score: `Σ max_field_weight(token) × ln(1 + N / df(token))` over distinct query tokens,
  scaled by 0.6 for private kinds, plus `0.2 × ln(1 + callers)`. Field weights: module last
  segment + name 3, purpose and first doc paragraph 2, later doc paragraphs, spec and
  the text of pattern entries citing the function (`:pattern_text`) 1.
  A query token also matches a field token sharing its first 5 chars at 0.6 × that field's
  weight, keeping the larger of exact and prefix weight (df counts both). Tokens drop a plural
  "s" and a light suffix (-ancy/-ance/-ing/-ion/-ed/-er) when 4+ chars remain. A private name/arity with
  3+ copies is treated as a helper: no 0.6 scaling, and callers are summed over the copies.
  """

  alias ExAtlas.Index

  @stopwords ~w(a an the to of by if in for and or is with from on it)
  @private [:defp, :defmacrop]
  @prefix 5
  @prefix_factor 0.6
  @suffixes ~w(ancy ance ing ion ed er)

  @typedoc "Query-independent search data; build once with `corpus/3`, reuse across queries."
  @type corpus :: %{
          entries: [{map(), map(), map()}],
          n: non_neg_integer(),
          helpers: map(),
          copies: map(),
          purposes: map()
        }

  @doc """
  `find(index, purposes, query, opts \\\\ [])` builds a corpus per call (`:pattern_text` opt);
  `find(corpus, query, opts)` reuses one from `corpus/3`.
  """
  @spec find(Index.t(), %{String.t() => String.t()}, String.t(), keyword()) :: [map()]
  def find(%Index{} = index, purposes, query, opts),
    do: index |> corpus(purposes, Keyword.get(opts, :pattern_text, %{})) |> find(query, opts)

  @spec find(Index.t() | corpus(), map() | String.t(), String.t() | keyword()) :: [map()]
  def find(%Index{} = index, purposes, query), do: find(index, purposes, query, [])

  def find(%{entries: entries, n: n} = corpus, query, opts) do
    limit = max(Keyword.get(opts, :limit, 10), 1)
    include_private = Keyword.get(opts, :include_private, true)
    query_tokens = query |> tokens() |> Enum.uniq()

    if query_tokens == [] or n == 0 do
      []
    else
      keyed =
        Enum.map(query_tokens, fn t ->
          {t, if(String.length(t) >= @prefix, do: String.slice(t, 0, @prefix))}
        end)

      # Only functions matching some query token: most match none, so this keeps queries cheap.
      weighted =
        for {f, w, p} <- entries,
            matched = token_weights(w, p, keyed),
            matched != %{},
            do: {f, matched}

      idf =
        Map.new(query_tokens, fn t ->
          df = Enum.count(weighted, fn {_, w} -> is_map_key(w, t) end)
          {t, if(df == 0, do: 0.0, else: :math.log(1 + n / df))}
        end)

      # N and df use the whole index so scores do not depend on include_private.
      weighted
      |> Enum.filter(fn {f, _} -> include_private or f.kind not in @private end)
      |> Enum.flat_map(fn {f, w} ->
        score(f, w, query_tokens, idf, corpus.purposes, corpus.helpers)
      end)
      |> group_private(corpus.copies)
      |> Enum.sort_by(&{-&1.score, &1.id})
      |> Enum.take(limit)
    end
  end

  @doc "Tokenizes and weights every function once; pass the result to `find/3`."
  @spec corpus(Index.t(), %{String.t() => String.t()}, %{String.t() => [String.t()]}) ::
          corpus()
  def corpus(%Index{functions: functions}, purposes, texts) do
    all = Map.values(functions)
    private = Enum.filter(all, &(&1.kind in @private))

    entries =
      Enum.map(all, fn f ->
        w = field_weights(f, purposes, texts)
        {f, w, prefixes(w)}
      end)

    copies =
      private
      |> Enum.group_by(&name_arity/1)
      |> Map.new(fn {k, g} ->
        {k, g |> Enum.sort_by(& &1.id) |> Enum.map(&Map.take(&1, [:id, :file, :line]))}
      end)

    %{
      entries: entries,
      n: length(all),
      helpers: helper_groups(private),
      copies: copies,
      purposes: purposes
    }
  end

  defp score(f, weights, query_tokens, idf, purposes, helpers) do
    base = Enum.sum(for t <- query_tokens, w = weights[t], do: w * idf[t])

    if base == 0 do
      []
    else
      # A private name/arity copied in 3+ modules is a de-facto helper: no penalty, callers pooled.
      {kind_factor, callers} =
        case f.kind in @private && helpers[name_arity(f)] do
          falsy when falsy in [nil, false] ->
            {if(f.kind in @private, do: 0.6, else: 1.0), f.callers}

          pooled ->
            {1.0, pooled}
        end

      score = base * kind_factor + 0.2 * :math.log(1 + callers)

      [
        %{
          id: f.id,
          kind: f.kind,
          file: f.file,
          line: f.line,
          doc: f.doc,
          spec: f.spec,
          purpose: Map.get(purposes, f.id),
          callers: f.callers,
          area: f.area,
          score: score,
          copies: []
        }
      ]
    end
  end

  # name/arity => summed callers, for private groups with >= 3 copies
  defp helper_groups(private) do
    private
    |> Enum.group_by(&name_arity/1)
    |> Enum.filter(fn {_, g} -> length(g) >= 3 end)
    |> Map.new(fn {k, g} -> {k, Enum.sum(Enum.map(g, & &1.callers))} end)
  end

  defp group_private(results, copies) do
    {private, public} = Enum.split_with(results, &(&1.kind in @private))

    grouped =
      private
      |> Enum.group_by(&name_arity/1)
      |> Enum.map(fn {_, [_ | _] = group} ->
        best = Enum.min_by(group, &{-&1.score, &1.id})
        %{best | copies: copies[name_arity(best)]}
      end)

    public ++ grouped
  end

  # "Mod.name/arity" -> "name/arity"
  defp name_arity(%{id: id}), do: id |> String.split(".") |> List.last()

  # first @prefix chars => max weight of the tokens starting with them
  defp prefixes(weights) do
    Enum.reduce(weights, %{}, fn {t, w}, acc ->
      if String.length(t) >= @prefix,
        do: Map.update(acc, String.slice(t, 0, @prefix), w, &max(&1, w)),
        else: acc
    end)
  end

  # query token => max(exact weight, @prefix_factor x the best field token sharing its first
  # @prefix chars), for matched tokens only. The prefix max may include the token itself;
  # 0.6 x its own weight never wins the max.
  defp token_weights(weights, prefixes, keyed) do
    for {t, key} <- keyed,
        w = best(weights[t], key && prefixes[key]),
        into: %{},
        do: {t, w}
  end

  defp best(exact, nil), do: exact
  defp best(nil, prefix), do: prefix * @prefix_factor
  defp best(exact, prefix), do: max(exact, prefix * @prefix_factor)

  # token => max weight across fields
  defp field_weights(f, purposes, texts) do
    last_segment = f.module |> Module.split() |> List.last()

    [
      {3, tokens(last_segment) ++ tokens(Atom.to_string(f.name))},
      {2, tokens(Map.get(purposes, f.id))},
      {2, tokens(f.doc)},
      {1, tokens(f.doc_rest)},
      {1, tokens(f.spec)},
      {1, texts |> Map.get(f.id, []) |> Enum.flat_map(&tokens/1)}
    ]
    |> Enum.reduce(%{}, fn {w, toks}, acc ->
      Enum.reduce(toks, acc, fn t, a -> Map.update(a, t, w, &max(&1, w)) end)
    end)
  end

  defp tokens(nil), do: []

  defp tokens(text) do
    text
    |> String.replace(~r/([a-z0-9])([A-Z])/, "\\1 \\2")
    |> String.downcase()
    |> String.split(~r/[^a-z0-9]+/, trim: true)
    |> Enum.reject(&(&1 in @stopwords or String.length(&1) == 1))
    |> Enum.map(&stem/1)
  end

  defp stem(t) do
    t =
      if String.length(t) > 3 and String.ends_with?(t, "s") and not String.ends_with?(t, "ss"),
        do: String.slice(t, 0..-2//1),
        else: t

    # Light suffix strip, keeping a stem of at least 4 chars ("importer" -> "import").
    case Enum.find(
           @suffixes,
           &(String.ends_with?(t, &1) and String.length(t) - String.length(&1) >= 4)
         ) do
      nil -> t
      s -> String.slice(t, 0, String.length(t) - String.length(s))
    end
  end
end
