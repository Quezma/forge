defmodule ExAtlas.UsageLog do
  @moduledoc "Appends one JSON line per tool call to `<dir>/usage.jsonl`, tagged with git branch and sha."

  @spec append(Path.t(), String.t(), map(), [String.t()]) :: :ok
  def append(dir, tool, input, result_ids) do
    root = Path.dirname(dir)
    File.mkdir_p!(dir)

    line =
      JSON.encode!(%{
        ts: DateTime.utc_now() |> DateTime.to_iso8601(),
        branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
        sha: git(root, ["rev-parse", "HEAD"]),
        tool: tool,
        input: input,
        results: result_ids
      })

    File.write!(Path.join(dir, "usage.jsonl"), line <> "\n", [:append])
  end

  defp git(root, args) do
    case System.cmd("git", args, cd: root, stderr_to_stdout: true) do
      {out, 0} -> String.trim(out)
      _ -> nil
    end
  rescue
    # git executable missing (or root not a directory)
    _ -> nil
  end
end
