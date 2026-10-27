defmodule ExAtlas.UsageLogTest do
  use ExUnit.Case, async: true
  alias ExAtlas.UsageLog

  @moduletag :tmp_dir

  test "appends a parseable line; branch nil outside a git repo" do
    # tmp_dir lives inside the ex_atlas repo, so use the system tmp for a non-git dir
    tmp = Path.join(System.tmp_dir!(), "ex_atlas_usage_#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(tmp) end)
    dir = Path.join([tmp, "proj", ".ex_atlas"])
    assert :ok = UsageLog.append(dir, "find_reusable", %{"query" => "x"}, ["A.b/1"])
    [line] = dir |> Path.join("usage.jsonl") |> File.read!() |> String.split("\n", trim: true)
    m = JSON.decode!(line)
    assert m["tool"] == "find_reusable"
    assert m["input"] == %{"query" => "x"}
    assert m["results"] == ["A.b/1"]
    assert is_binary(m["ts"])
    assert m["branch"] == nil
    assert m["sha"] == nil
  end

  test "records branch and sha inside a git repo", %{tmp_dir: tmp} do
    root = Path.join(tmp, "repo")
    File.mkdir_p!(root)
    git = fn args -> System.cmd("git", args, cd: root, stderr_to_stdout: true) end
    git.(["init", "-q", "-b", "feat"])

    git.([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "i"
    ])

    dir = Path.join(root, ".ex_atlas")
    :ok = UsageLog.append(dir, "t", %{}, [])
    m = dir |> Path.join("usage.jsonl") |> File.read!() |> JSON.decode!()
    assert m["branch"] == "feat"
    assert m["sha"] =~ ~r/\A[0-9a-f]{40}\z/
  end
end
