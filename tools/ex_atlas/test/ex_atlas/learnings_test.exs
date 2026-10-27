defmodule ExAtlas.LearningsTest do
  use ExUnit.Case, async: true
  alias ExAtlas.Learnings

  @moduletag :tmp_dir

  defp learning(cause, extra \\ %{}) do
    Map.merge(
      %{
        "project" => "sample_app",
        "branch" => "feat",
        "cause" => cause,
        "query" => "send mail",
        "tool" => "find_reusable",
        "expected" => "Mailer.deliver/1",
        "actual" => "nothing",
        "evidence" => "grep"
      },
      extra
    )
  end

  defp lines(path),
    do: path |> File.read!() |> String.split("\n", trim: true) |> Enum.map(&JSON.decode!/1)

  test "tool_miss writes learning and fixture", %{tmp_dir: root} do
    assert :ok =
             Learnings.record(
               root,
               learning("tool_miss", %{"args" => %{"query" => "send mail", "k" => 3}})
             )

    [l] = lines(Path.join(root, "learnings/open.jsonl"))
    assert l["cause"] == "tool_miss"
    assert is_binary(l["recorded_at"])
    [f] = lines(Path.join(root, "test/acceptance/sample_app.jsonl"))

    assert f == %{
             "tool" => "find_reusable",
             "args" => %{"query" => "send mail", "k" => 3},
             "expect" => "Mailer.deliver/1",
             "top_k" => 5
           }
  end

  test "fixture args default to the query", %{tmp_dir: root} do
    :ok = Learnings.record(root, learning("tool_miss"))
    [f] = lines(Path.join(root, "test/acceptance/sample_app.jsonl"))
    assert f["args"] == %{"query" => "send mail"}
  end

  test "agent_ignored writes only the learnings file", %{tmp_dir: root} do
    assert :ok = Learnings.record(root, learning("agent_ignored"))
    assert File.exists?(Path.join(root, "learnings/open.jsonl"))
    refute File.exists?(Path.join(root, "test/acceptance"))
  end

  test "validation errors", %{tmp_dir: root} do
    assert {:error, "missing: query"} =
             Learnings.record(root, Map.delete(learning("tool_miss"), "query"))

    assert {:error, "invalid cause: " <> _} = Learnings.record(root, learning("bogus"))

    assert {:error, "invalid project: " <> _} =
             Learnings.record(root, learning("tool_miss", %{"project" => "../x"}))

    refute File.exists?(Path.join(root, "learnings"))
  end

  test "tool and expected are validated", %{tmp_dir: root} do
    assert {:error, "invalid tool: " <> _} =
             Learnings.record(root, learning("tool_miss", %{"tool" => "module"}))

    assert {:error, "invalid expected: " <> _} =
             Learnings.record(root, learning("tool_miss", %{"expected" => 5}))

    assert {:error, "invalid expected: " <> _} =
             Learnings.record(root, learning("tool_miss", %{"expected" => ""}))

    refute File.exists?(Path.join(root, "learnings"))
  end

  test "args must be an object; context_for_task needs task and areas", %{tmp_dir: root} do
    assert {:error, "invalid args: " <> _} =
             Learnings.record(root, learning("tool_miss", %{"args" => "q"}))

    cft = %{"tool" => "context_for_task"}
    assert {:error, "invalid args: " <> _} = Learnings.record(root, learning("tool_miss", cft))

    assert {:error, _} =
             Learnings.record(
               root,
               learning("tool_miss", Map.put(cft, "args", %{"query" => "x"}))
             )

    assert {:error, _} =
             Learnings.record(
               root,
               learning("tool_miss", Map.put(cft, "args", %{"task" => "t", "areas" => "web"}))
             )

    refute File.exists?(Path.join(root, "learnings"))

    args = %{"task" => "t", "areas" => ["web"]}
    assert :ok = Learnings.record(root, learning("tool_miss", Map.put(cft, "args", args)))
    [f] = lines(Path.join(root, "test/acceptance/sample_app.jsonl"))
    assert f["args"] == args
  end

  test "actual may be any JSON value", %{tmp_dir: root} do
    assert :ok = Learnings.record(root, learning("tool_miss", %{"actual" => 4}))
  end

  test "repo_root points at the ex_atlas repo" do
    assert File.exists?(Path.join(Learnings.repo_root(), "mix.exs"))
  end
end
