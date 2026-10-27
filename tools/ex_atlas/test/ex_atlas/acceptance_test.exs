defmodule ExAtlas.AcceptanceTest do
  use ExUnit.Case, async: true

  alias ExAtlas.{Acceptance, Index}

  defp fun(id, doc) do
    [mod, rest] =
      id |> String.split(".") |> then(&[Enum.join(Enum.drop(&1, -1), "."), List.last(&1)])

    [name, arity] = String.split(rest, "/")

    {id,
     %{
       id: id,
       module: Module.concat([mod]),
       name: String.to_atom(name),
       arity: String.to_integer(arity),
       kind: :def,
       file: "lib/x.ex",
       line: 1,
       doc: doc,
       doc_rest: nil,
       spec: nil,
       area: :core,
       callers: 0
     }}
  end

  defp index do
    %Index{
      app: :fx,
      functions:
        Map.new([
          fun("Fx.Surveys.fetch_company_survey/3", "Load a survey by id scoped to the company."),
          fun("Fx.Strings.blank_to_nil/1", "Convert blank string to nil."),
          fun("Fx.Other.thing/0", "Unrelated helper.")
        ])
    }
  end

  defp check(fixture), do: Acceptance.check(index(), %{areas: %{}, warnings: []}, fixture)

  test "exact id match passes with its rank" do
    assert {:pass, 1} =
             check(%{
               "tool" => "find_reusable",
               "args" => %{"query" => "load a survey by id scoped to the company"},
               "expect" => "Fx.Surveys.fetch_company_survey/3",
               "top_k" => 5
             })
  end

  test "bare name matches as an id suffix" do
    assert {:pass, 1} =
             check(%{
               "tool" => "find_reusable",
               "args" => %{"query" => "convert blank string to nil"},
               "expect" => "blank_to_nil/1",
               "top_k" => 3
             })
  end

  test "miss fails with the top ids" do
    assert {:fail, top} =
             check(%{
               "tool" => "find_reusable",
               "args" => %{"query" => "convert blank string to nil"},
               "expect" => "Fx.Nope.nope/1",
               "top_k" => 3
             })

    assert hd(top) == "Fx.Strings.blank_to_nil/1"
  end

  test "context_for_task matches emitted entry ids exactly" do
    loaded = %{
      areas: %{"_global" => %{"entries" => [%{"id" => "web-10"}, %{"id" => "g-1"}]}},
      warnings: []
    }

    fixture = fn expect ->
      %{
        "tool" => "context_for_task",
        "args" => %{"task" => "add survey fetch", "areas" => []},
        "expect" => expect
      }
    end

    assert {:pass, nil} = Acceptance.check(index(), loaded, fixture.("web-10"))
    assert {:fail, []} = Acceptance.check(index(), loaded, fixture.("web-1"))
  end

  test "malformed fixture args fail instead of crashing" do
    for f <- [
          %{"tool" => "find_reusable", "args" => "oops", "expect" => "a/1"},
          %{"tool" => "find_reusable", "args" => %{}, "expect" => "a/1"},
          %{"tool" => "context_for_task", "args" => %{"task" => "t"}, "expect" => "a"},
          %{"tool" => "context_for_task", "args" => "oops", "expect" => "a"},
          %{"tool" => "find_reusable", "args" => %{"query" => "q"}, "expect" => 5}
        ] do
      assert {:fail, [_]} = check(f)
    end
  end

  test "format lines" do
    f = %{"tool" => "find_reusable", "args" => %{"query" => "q"}, "expect" => "a/1"}
    assert Acceptance.format(f, {:pass, 2}) == "PASS find_reusable q → rank 2"

    assert Acceptance.format(f, {:fail, ["x", "y"]}) ==
             "FAIL find_reusable q → expected a/1, top: x, y"
  end

  test "load returns [] for a missing file" do
    assert Acceptance.load("/nonexistent/x.jsonl") == []
  end

  test "unknown tool fails instead of crashing" do
    assert {:fail, ["unknown tool: nope"]} =
             check(%{"tool" => "nope", "args" => %{}, "expect" => "x"})
  end

  test "load skips blank lines" do
    path = Path.join(System.tmp_dir!(), "acc_#{System.unique_integer([:positive])}.jsonl")
    File.write!(path, ~s({"tool":"a"}\n\n   \n{"tool":"b"}\n))
    assert [%{"tool" => "a"}, %{"tool" => "b"}] = Acceptance.load(path)
  end

  test "purposes under <root>/.ex_atlas/patterns affect the result" do
    root = Path.join(System.tmp_dir!(), "acc_root_#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, ".ex_atlas/patterns"))
    on_exit(fn -> File.rm_rf!(root) end)

    fixture = %{
      "tool" => "find_reusable",
      "args" => %{"query" => "tenant membership check"},
      "expect" => "Fx.Other.thing/0",
      "top_k" => 3
    }

    assert {:fail, _} = Acceptance.check(index(), Acceptance.load_patterns(root), fixture)

    File.write!(
      Path.join(root, ".ex_atlas/patterns/core.json"),
      JSON.encode!(%{
        "entries" => [],
        "purposes" => %{"Fx.Other.thing/0" => "Check the tenant membership."}
      })
    )

    assert {:pass, 1} = Acceptance.check(index(), Acceptance.load_patterns(root), fixture)
  end

  test "pattern entry text is searched on the functions it cites" do
    root = Path.join(System.tmp_dir!(), "acc_root_#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, ".ex_atlas/patterns"))
    on_exit(fn -> File.rm_rf!(root) end)

    fixture = %{
      "tool" => "find_reusable",
      "args" => %{"query" => "tenant membership check"},
      "expect" => "Fx.Other.thing/0",
      "top_k" => 3
    }

    File.write!(
      Path.join(root, ".ex_atlas/patterns/core.json"),
      JSON.encode!(%{
        "entries" => [
          %{
            "id" => "core-1",
            "kind" => "rule",
            "text" => "Check tenant membership with thing/0.",
            "evidence" => ["Fx.Other.thing/0"]
          }
        ]
      })
    )

    assert {:pass, 1} = Acceptance.check(index(), Acceptance.load_patterns(root), fixture)
  end

  test "summary computes hit@k and MRR over ranks (nil = miss)" do
    s = Acceptance.summary([1, 3, nil, 7, 12])
    assert %{n: 5, hit1: 1, hit5: 2, hit10: 3} = s
    assert_in_delta s.mrr, (1 + 1 / 3 + 1 / 7 + 1 / 12) / 5, 1.0e-9
  end

  test "summary of no results is all zero" do
    assert Acceptance.summary([]) == %{n: 0, hit1: 0, hit5: 0, hit10: 0, mrr: 0.0}
  end

  test "format_summary prints counts and rates" do
    assert Acceptance.format_summary(Acceptance.summary([1, nil])) ==
             "n=2 hit@1=1 (0.50) hit@5=1 (0.50) hit@10=1 (0.50) MRR=0.500"
  end

  test "eval_rank finds ranks beyond the fixture top_k and nil on a miss" do
    f = %{
      "tool" => "find_reusable",
      "args" => %{"query" => "convert blank string to nil"},
      "expect" => "blank_to_nil/1",
      "top_k" => 0
    }

    assert Acceptance.eval_rank(index(), %{areas: %{}, warnings: []}, f) == 1

    assert Acceptance.eval_rank(index(), %{areas: %{}, warnings: []}, %{f | "expect" => "X.y/1"}) ==
             nil
  end
end
