defmodule ExAtlas.PatternsTest do
  use ExUnit.Case, async: true

  alias ExAtlas.{Index, Patterns}

  @fun "Fx.Accounts.fetch/1"

  setup do
    dir = Path.join(System.tmp_dir!(), "patterns_#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)

    index = %Index{
      app: :fx,
      functions: %{@fun => %{id: @fun}},
      modules: %{Fx.Accounts => %{file: "lib/fx/accounts.ex"}}
    }

    {:ok, dir: dir, index: index}
  end

  defp entry(evidence), do: %{"kind" => "rule", "text" => "Use fetch", "evidence" => evidence}

  test "add writes the file and assigns an id", %{dir: dir, index: index} do
    assert {:ok, %{"id" => "accounts-1", "audience" => "internal"}} =
             Patterns.record(dir, index, "accounts", "add", entry([@fun, "Fx.Accounts"]))

    raw = File.read!(Path.join(dir, "patterns/accounts.json"))
    assert String.ends_with?(raw, "\n")

    assert %{areas: %{"accounts" => %{"entries" => [%{"id" => "accounts-1"}]}}} =
             Patterns.load_all(dir)
  end

  test "add with unknown evidence errors and writes nothing", %{dir: dir, index: index} do
    assert {:error, "unknown evidence: Nope.x/0"} =
             Patterns.record(dir, index, "accounts", "add", entry([@fun, "Nope.x/0"]))

    refute File.exists?(Path.join(dir, "patterns/accounts.json"))
  end

  test "add validates required fields", %{dir: dir, index: index} do
    assert {:error, _} =
             Patterns.record(dir, index, "a", "add", %{
               "kind" => "rule",
               "text" => "x",
               "evidence" => []
             })

    assert {:error, _} =
             Patterns.record(dir, index, "a", "add", %{entry([@fun]) | "kind" => "bogus"})

    assert {:error, _} =
             Patterns.record(dir, index, "a", "add", Map.put(entry([@fun]), "audience", "x"))
  end

  test "ids never repeat after retire; retire and update", %{dir: dir, index: index} do
    for _ <- 1..2, do: Patterns.record(dir, index, "a", "add", entry([@fun]))
    assert {:ok, _} = Patterns.record(dir, index, "a", "retire", %{"id" => "a-1"})
    assert {:ok, %{"id" => "a-3"}} = Patterns.record(dir, index, "a", "add", entry([@fun]))

    assert {:ok, %{"text" => "new", "kind" => "rule"}} =
             Patterns.record(dir, index, "a", "update", %{"id" => "a-2", "text" => "new"})

    assert {:error, "unknown evidence: Z"} =
             Patterns.record(dir, index, "a", "update", %{"id" => "a-2", "evidence" => ["Z"]})

    assert {:error, "unknown entry: a-9"} =
             Patterns.record(dir, index, "a", "update", %{"id" => "a-9"})

    assert {:error, "unknown entry: a-9"} =
             Patterns.record(dir, index, "a", "retire", %{"id" => "a-9"})

    ids = Patterns.load_all(dir).areas["a"]["entries"] |> Enum.map(& &1["id"])
    assert ids == ["a-2", "a-3"]
  end

  test "stale reports entries whose evidence left the index", %{dir: dir, index: index} do
    Patterns.record(dir, index, "accounts", "add", entry([@fun, "Fx.Accounts"]))
    loaded = Patterns.load_all(dir)
    assert Patterns.stale(loaded, index) == []

    gone = %{index | functions: %{}}

    assert [%{area: "accounts", entry_id: "accounts-1", missing: [@fun]}] =
             Patterns.stale(loaded, gone)
  end

  test "set_purpose stores and purposes reads", %{dir: dir, index: index} do
    assert :ok = Patterns.set_purpose(dir, index, "accounts", @fun, "Loads an account")
    assert {:error, _} = Patterns.set_purpose(dir, index, "accounts", "Nope.x/0", "x")
    assert Patterns.purposes(Patterns.load_all(dir)) == %{@fun => "Loads an account"}
  end

  test "invalid file warns and others still load", %{dir: dir, index: index} do
    Patterns.record(dir, index, "good", "add", entry([@fun]))
    File.write!(Path.join(dir, "patterns/bad.json"), "{not json")
    assert %{areas: areas, warnings: [w]} = Patterns.load_all(dir)
    assert Map.keys(areas) == ["good"]
    assert w =~ "bad.json"
  end

  test "load_all on missing dir is empty", %{dir: dir} do
    assert Patterns.load_all(dir) == %{areas: %{}, warnings: []}
  end

  test "invalid areas are rejected and nothing is written", %{dir: dir, index: index} do
    for area <- ["../x", "a/b", "", "a b"] do
      assert {:error, "invalid area: " <> _} =
               Patterns.record(dir, index, area, "add", entry([@fun]))

      assert {:error, "invalid area: " <> _} = Patterns.set_purpose(dir, index, area, @fun, "x")
    end

    refute File.exists?(dir)
    assert {:ok, _} = Patterns.record(dir, index, "_global", "add", entry([@fun]))
  end

  test "unparseable existing file is never overwritten", %{dir: dir, index: index} do
    File.mkdir_p!(Path.join(dir, "patterns"))
    path = Path.join(dir, "patterns/a.json")
    File.write!(path, "<<<<<<< HEAD\n{}")

    assert {:error, "invalid pattern file: " <> _} =
             Patterns.record(dir, index, "a", "add", entry([@fun]))

    assert {:error, "invalid pattern file: " <> _} =
             Patterns.set_purpose(dir, index, "a", @fun, "x")

    assert File.read!(path) == "<<<<<<< HEAD\n{}"

    File.write!(path, ~s({"entries": null, "purposes": null}))

    assert {:error, "invalid pattern file: " <> _} =
             Patterns.record(dir, index, "a", "add", entry([@fun]))
  end

  test "malformed input returns errors", %{dir: dir, index: index} do
    {:ok, _} = Patterns.record(dir, index, "a", "add", entry([@fun]))

    assert {:error, _} =
             Patterns.record(dir, index, "a", "update", %{"id" => "a-1", "evidence" => "x"})

    assert {:error, _} =
             Patterns.record(dir, index, "a", "update", %{"id" => "a-1", "evidence" => []})

    assert {:error, _} =
             Patterns.record(dir, index, "a", "add", %{entry([@fun]) | "evidence" => "x"})

    assert {:error, _} =
             Patterns.record(dir, index, "a", "add", %{entry([@fun]) | "evidence" => [1]})
  end

  test "pattern_text maps each cited id to the texts of the entries citing it",
       %{dir: dir, index: index} do
    {:ok, _} = Patterns.record(dir, index, "a", "add", entry([@fun, "Fx.Accounts"]))
    {:ok, _} = Patterns.record(dir, index, "b", "add", %{entry([@fun]) | "text" => "Other"})

    texts = Patterns.pattern_text(Patterns.load_all(dir))
    assert Enum.sort(texts[@fun]) == ["Other", "Use fetch"]
  end

  test "special characters round-trip", %{dir: dir, index: index} do
    text = "say \"hi\" \\ caf\u00e9 \u2603\nline2\ttab"
    {:ok, _} = Patterns.record(dir, index, "a", "add", %{entry([@fun]) | "text" => text})
    assert %{areas: %{"a" => %{"entries" => [%{"text" => ^text}]}}} = Patterns.load_all(dir)
  end

  test "shape-invalid files are skipped on load and refused on record", %{dir: dir, index: index} do
    {:ok, _} = Patterns.record(dir, index, "good", "add", entry([@fun]))
    File.write!(Path.join(dir, "patterns/p.json"), ~s({"entries": [], "purposes": "x"}))
    File.write!(Path.join(dir, "patterns/e.json"), ~s({"entries": [1]}))

    File.write!(
      Path.join(dir, "patterns/v.json"),
      ~s({"entries": [{"id": "v-1", "evidence": "x"}]})
    )

    File.write!(Path.join(dir, "patterns/l.json"), "[]")

    loaded = Patterns.load_all(dir)
    assert Map.keys(loaded.areas) == ["good"]
    assert length(loaded.warnings) == 4
    assert Patterns.purposes(loaded) == %{}
    assert Patterns.stale(loaded, index) == []

    for area <- ["p", "e", "v", "l"] do
      before = File.read!(Path.join(dir, "patterns/#{area}.json"))

      assert {:error, "invalid pattern file: " <> _} =
               Patterns.record(dir, index, area, "add", entry([@fun]))

      assert {:error, "invalid pattern file: " <> _} =
               Patterns.set_purpose(dir, index, area, @fun, "x")

      assert File.read!(Path.join(dir, "patterns/#{area}.json")) == before
    end
  end

  test "non-binary client values return errors instead of raising", %{dir: dir, index: index} do
    assert {:error, "invalid area: " <> _} =
             Patterns.record(dir, index, %{"a" => 1}, "add", entry([@fun]))

    assert {:error, "invalid area: " <> _} = Patterns.set_purpose(dir, index, %{}, @fun, "x")
    {:ok, _} = Patterns.record(dir, index, "a", "add", entry([@fun]))

    assert {:error, "unknown entry: " <> _} =
             Patterns.record(dir, index, "a", "retire", %{"id" => %{}})

    assert {:error, "unknown entry: " <> _} =
             Patterns.record(dir, index, "a", "update", %{"id" => 5})

    assert {:error, "unknown function: " <> _} = Patterns.set_purpose(dir, index, "a", %{}, "x")
  end

  test "set_purpose rejects invalid text without writing", %{dir: dir, index: index} do
    for text <- [5, nil, %{}, "  "] do
      assert {:error, "invalid purpose text"} = Patterns.set_purpose(dir, index, "a", @fun, text)
    end

    refute File.exists?(dir)
  end
end
