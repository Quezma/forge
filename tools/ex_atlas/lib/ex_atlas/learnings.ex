defmodule ExAtlas.Learnings do
  @moduledoc "Records search misses centrally in the ex_atlas repo, plus regression fixtures for tool misses."

  @repo_root Path.expand("../..", __DIR__)
  @required ~w(project branch cause query tool expected actual evidence)
  @tools ~w(find_reusable context_for_task)

  @spec repo_root() :: String.t()
  def repo_root, do: @repo_root

  @spec record(Path.t(), map()) :: :ok | {:error, String.t()}
  def record(repo_root, learning) do
    with :ok <- validate(learning) do
      append(
        Path.join([repo_root, "learnings", "open.jsonl"]),
        Map.put(learning, "recorded_at", now())
      )

      if learning["cause"] == "tool_miss" do
        append(Path.join([repo_root, "test", "acceptance", learning["project"] <> ".jsonl"]), %{
          tool: learning["tool"],
          args: fixture_args(learning),
          expect: learning["expected"],
          top_k: 5
        })
      end

      :ok
    end
  end

  defp validate(learning) do
    cond do
      key = Enum.find(@required, &(not Map.has_key?(learning, &1))) ->
        {:error, "missing: #{key}"}

      learning["cause"] not in ["tool_miss", "agent_ignored"] ->
        {:error, "invalid cause: #{inspect(learning["cause"])}"}

      not (is_binary(learning["project"]) and learning["project"] =~ ~r/\A[a-z0-9_]+\z/) ->
        {:error, "invalid project: #{inspect(learning["project"])}"}

      learning["tool"] not in @tools ->
        {:error, "invalid tool: #{inspect(learning["tool"])}"}

      not (is_binary(learning["expected"]) and learning["expected"] != "") ->
        {:error, "invalid expected: must be a non-empty string"}

      true ->
        validate_args(learning["tool"], learning["args"])
    end
  end

  defp validate_args(_tool, args) when not is_map(args) and not is_nil(args),
    do: {:error, "invalid args: must be an object"}

  defp validate_args("context_for_task", %{"task" => t, "areas" => a})
       when is_binary(t) and is_list(a), do: :ok

  defp validate_args("context_for_task", _),
    do: {:error, "invalid args: context_for_task needs task (string) and areas (list)"}

  defp validate_args(_, _), do: :ok

  # find_reusable fixtures default to the query; context_for_task args were validated above.
  defp fixture_args(l), do: l["args"] || %{"query" => l["query"]}

  # ponytail: a single append write per line; no cross-process locking
  defp append(path, term) do
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, JSON.encode!(term) <> "\n", [:append])
  end

  defp now, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
