defmodule ExAtlas.SearchTest do
  use ExUnit.Case, async: true

  alias ExAtlas.{Index, Search}

  defp fun(mod, name, arity, attrs \\ []) do
    id = "#{mod}.#{name}/#{arity}"

    {id,
     Map.merge(
       %{
         id: id,
         module: Module.concat([mod]),
         name: name,
         arity: arity,
         kind: :def,
         file: "lib/#{name}.ex",
         line: 1,
         doc: nil,
         doc_rest: nil,
         spec: nil,
         area: :core,
         callers: 0
       },
       Map.new(attrs)
     )}
  end

  defp index(funs), do: %Index{app: :fx, functions: Map.new(funs)}

  test "doc match on public function beats private lookalike" do
    idx =
      index([
        fun("Fx.Surveys", :fetch_company_survey, 3,
          doc:
            "The company's survey `id`, or `nil` when it is unknown, malformed or another company's."
        ),
        fun("Fx.SurveyController", :fetch_owned_survey, 3, kind: :defp),
        fun("Fx.Accounts", :fetch, 1)
      ])

    [first, second | _] = Search.find(idx, %{}, "load a survey by id scoped to the company")
    assert first.id == "Fx.Surveys.fetch_company_survey/3"
    assert second.id == "Fx.SurveyController.fetch_owned_survey/3"
  end

  defp copies(names, callers, kind \\ :defp),
    do:
      for(
        {m, c} <- Enum.zip(names, callers),
        do: fun(m, :blank_to_nil, 1, kind: kind, callers: c)
      )

  test "a private name/arity with 3+ copies is not penalized and outranks an equal public one" do
    idx =
      index(
        copies(["Fx.Aa", "Fx.Bb", "Fx.Cc"], [1, 1, 1]) ++
          [fun("Fx.Zpub", :blank_to_nil, 1, callers: 1)]
      )

    assert [%{id: "Fx.Aa.blank_to_nil/1", copies: [_, _, _]}, %{id: "Fx.Zpub.blank_to_nil/1"}] =
             Search.find(idx, %{}, "blank to nil")
  end

  test "a private name/arity with only 2 copies is still penalized" do
    idx =
      index(copies(["Fx.Aa", "Fx.Bb"], [1, 1]) ++ [fun("Fx.Zpub", :blank_to_nil, 1, callers: 1)])

    assert [%{id: "Fx.Zpub.blank_to_nil/1"}, %{id: "Fx.Aa.blank_to_nil/1"}] =
             Search.find(idx, %{}, "blank to nil")
  end

  test "callers of a 3+ copy private group are summed over all copies" do
    grouped = index(copies(["Fx.Aa", "Fx.Bb", "Fx.Cc"], [4, 5, 6]))
    single = index([fun("Fx.Zpub", :blank_to_nil, 1, callers: 15)])

    [%{score: g}] = Search.find(grouped, %{}, "blank to nil")
    [%{score: s}] = Search.find(single, %{}, "blank to nil")
    assert_in_delta g, s, 1.0e-9
  end

  test "a non-positive limit is clamped to 1 and keeps the best hit" do
    idx =
      index([
        fun("Fx.Surveys", :fetch_company_survey, 3,
          doc: "Load a survey by id scoped to the company."
        ),
        fun("Fx.Accounts", :fetch_survey, 1, doc: "Load a survey.")
      ])

    for limit <- [-1, 0] do
      assert [%{id: "Fx.Surveys.fetch_company_survey/3"}] =
               Search.find(idx, %{}, "load a survey by id scoped to the company", limit: limit)
    end
  end

  test "purpose line makes an undocumented function rank first" do
    idx =
      index([
        fun("Fx.Tenancy", :fetch_company, 1),
        fun("Fx.Company", :list_all, 0, doc: "Lists every company."),
        fun("Fx.Tenant", :current, 0, doc: "The current tenant.")
      ])

    purposes = %{"Fx.Tenancy.fetch_company/1" => "check company exists in tenant"}

    assert [%{id: "Fx.Tenancy.fetch_company/1"} | _] =
             Search.find(idx, purposes, "check the company belongs to the current tenant")
  end

  test "later doc paragraphs are searched, below the first paragraph" do
    idx =
      index([
        fun("Fx.Companies", :fetch_company, 1,
          doc: "Reads a company.",
          doc_rest: "Runs inside the tenant transaction."
        ),
        fun("Fx.Other", :lookup, 1, doc: "Reads the tenant.")
      ])

    assert [
             %{id: "Fx.Other.lookup/1", score: first},
             %{id: "Fx.Companies.fetch_company/1", score: rest}
           ] =
             Search.find(idx, %{}, "tenant")

    assert_in_delta rest * 2, first, 1.0e-9
  end

  test "pattern text is searched at weight 1, only when passed" do
    idx =
      index([
        fun("Fx.Companies", :fetch_company, 1),
        fun("Fx.Other", :lookup, 1, doc: "Reads the tenant.")
      ])

    texts = %{"Fx.Companies.fetch_company/1" => ["Call it to scope by tenant."]}

    assert [
             %{id: "Fx.Other.lookup/1", score: doc},
             %{id: "Fx.Companies.fetch_company/1", score: pat}
           ] =
             Search.find(idx, %{}, "tenant", pattern_text: texts)

    assert_in_delta pat * 2, doc, 1.0e-9
    assert [%{id: "Fx.Other.lookup/1"}] = Search.find(idx, %{}, "tenant")
  end

  test "light suffix stemming joins inflections, but not on short stems" do
    idx =
      index([fun("Fx.Imports", :run, 0, doc: "Runs the importer."), fun("Fx.Seeds", :need, 0)])

    assert [%{id: "Fx.Imports.run/0"}] = Search.find(idx, %{}, "importing")
    assert [%{id: "Fx.Seeds.need/0"}] = Search.find(idx, %{}, "need")
    assert Search.find(idx, %{}, "nest") == []
  end

  test "a shared 5-char prefix matches at 0.6 of the field weight" do
    idx = index([fun("Fx.Tenancy", :fetch_company, 1), fun("Fx.Tenant", :current, 0)])

    assert [
             %{id: "Fx.Tenant.current/0", score: exact},
             %{id: "Fx.Tenancy.fetch_company/1", score: prefix}
           ] =
             Search.find(idx, %{}, "tenant")

    assert_in_delta prefix, exact * 0.6, 1.0e-9
    assert Search.find(idx, %{}, "tenor") == []
  end

  test "-ant is not stripped: important does not stem to import" do
    idx = index([fun("Fx.A", :important, 0), fun("Fx.B", :import, 0)])

    assert [%{id: "Fx.B.import/0", score: exact}, %{id: "Fx.A.important/0", score: prefix}] =
             Search.find(idx, %{}, "import")

    assert_in_delta prefix, exact * 0.6, 1.0e-9
  end

  test "a stronger prefix match beats a weaker exact match" do
    idx =
      index([
        fun("Fx.Tenancy", :fetch, 1, doc_rest: "Uses the tenant."),
        fun("Fx.Tenant", :current, 0)
      ])

    assert [%{id: "Fx.Tenant.current/0", score: exact}, %{id: "Fx.Tenancy.fetch/1", score: best}] =
             Search.find(idx, %{}, "tenant")

    assert_in_delta best, exact * 0.6, 1.0e-9
  end

  test "a prebuilt corpus returns the same results as find/4" do
    idx =
      index([
        fun("Fx.Surveys", :fetch_company_survey, 3, doc: "Load the company's survey."),
        fun("Fx.A", :parse_date, 1, kind: :defp),
        fun("Fx.B", :parse_date, 1, kind: :defp),
        fun("Fx.C", :parse_date, 1, kind: :defp),
        fun("Fx.Tenancy", :fetch, 1, callers: 3)
      ])

    purposes = %{"Fx.Tenancy.fetch/1" => "load a company"}
    texts = %{"Fx.A.parse_date/1" => ["Parse a survey date."]}
    corpus = Search.corpus(idx, purposes, texts)

    for q <- ["load company survey", "parse date", "tenant", "zebra", ""],
        opts <- [[], [limit: 1], [include_private: false]] do
      assert Search.find(corpus, q, opts) ==
               Search.find(idx, purposes, q, [pattern_text: texts] ++ opts)
    end
  end

  test "private copies with the same name/arity collapse" do
    idx =
      index([
        fun("Fx.A", :blank_to_nil, 1, kind: :defp, doc: "convert blank string to nil"),
        fun("Fx.B", :blank_to_nil, 1, kind: :defp),
        fun("Fx.C", :blank_to_nil, 1, kind: :defp)
      ])

    assert [r] = Search.find(idx, %{}, "convert blank string to nil")
    assert length(r.copies) == 3
    assert r.id == "Fx.A.blank_to_nil/1"
    assert Enum.all?(r.copies, &match?(%{id: _, file: _, line: _}, &1))
  end

  test "callers break ties between equal text" do
    idx =
      index([
        fun("Fx.A", :parse_date, 1, callers: 0),
        fun("Fx.B", :parse_date, 1, callers: 40)
      ])

    assert [%{id: "Fx.B.parse_date/1"}, %{id: "Fx.A.parse_date/1"}] =
             Search.find(idx, %{}, "parse date")
  end

  test "empty query, stopword-only query and no matches return []" do
    idx = index([fun("Fx.A", :parse_date, 1)])
    assert Search.find(idx, %{}, "") == []
    assert Search.find(idx, %{}, "the of a") == []
    assert Search.find(idx, %{}, "zebra") == []
  end

  test "include_private: false and limit" do
    idx =
      index([
        fun("Fx.A", :parse_date, 1),
        fun("Fx.B", :parse_date, 2, kind: :defp),
        fun("Fx.C", :parse_date, 3)
      ])

    ids = Search.find(idx, %{}, "parse date", include_private: false) |> Enum.map(& &1.id)
    refute "Fx.B.parse_date/2" in ids
    assert length(Search.find(idx, %{}, "parse date", limit: 1)) == 1
  end

  test "camelCase splitting and plural stripping" do
    idx = index([fun("Fx.UserProfiles", :loadAll, 0)])
    assert [_] = Search.find(idx, %{}, "user profile load all")
  end

  test "scores do not depend on include_private" do
    idx =
      index([
        fun("Fx.A", :parse_date, 1),
        fun("Fx.B", :parse_date, 2, kind: :defp),
        fun("Fx.C", :other, 0)
      ])

    score = fn opts ->
      idx
      |> Search.find(%{}, "parse date", opts)
      |> Enum.find(&(&1.id == "Fx.A.parse_date/1"))
      |> Map.get(:score)
    end

    assert score.(include_private: true) == score.(include_private: false)
  end

  test "copies list all private same name/arity entries, scored or not" do
    idx =
      index([
        fun("Fx.A", :blank_to_nil, 1, kind: :defp, doc: "convert blank string to nil"),
        fun("Fx.B", :blank_to_nil, 1, kind: :defp, doc: "unrelated zebra"),
        fun("Fx.C", :other, 0)
      ])

    assert [r] = Search.find(idx, %{}, "convert string")
    assert length(r.copies) == 2
  end

  test "possessive leaves no one-char token" do
    idx = index([fun("Fx.A", :other, 0, doc: "the company's thing"), fun("Fx.B", :s, 0)])
    assert Search.find(idx, %{}, "s") == []
  end
end
