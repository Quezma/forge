defmodule ExAtlas.Patterns do
  @moduledoc """
  Pattern knowledge store: committed JSON files in `<dir>/patterns/<area>.json`
  (global rules in `_global.json`), each entry citing evidence symbols.
  """

  alias ExAtlas.Index

  @kinds ~w(rule helper api anti_pattern)
  @audiences ~w(internal external)

  @spec load_all(Path.t()) :: %{areas: map(), warnings: [String.t()]}
  def load_all(dir) do
    dir
    |> Path.join("patterns/*.json")
    |> Path.wildcard()
    |> Enum.sort()
    |> Enum.reduce(%{areas: %{}, warnings: []}, fn path, acc ->
      case read_file(path) do
        {:ok, map} ->
          %{acc | areas: Map.put(acc.areas, Path.basename(path, ".json"), map)}

        :error ->
          %{
            acc
            | warnings: acc.warnings ++ ["skipped invalid pattern file: #{Path.basename(path)}"]
          }
      end
    end)
  end

  @spec record(Path.t(), Index.t(), String.t(), String.t(), map()) ::
          {:ok, map()} | {:error, String.t()}
  def record(dir, index, area, "add", entry) do
    with {:ok, file} <- read_area(dir, area),
         :ok <- require_fields(entry),
         :ok <- check_enum(entry, "kind", @kinds),
         :ok <- check_enum(Map.put_new(entry, "audience", "internal"), "audience", @audiences),
         :ok <- check_evidence(index, entry["evidence"]) do
      new =
        entry
        |> Map.take(~w(kind audience text evidence prevalence))
        |> Map.put_new("audience", "internal")
        |> Map.put("id", "#{area}-#{next_n(file["entries"])}")

      write(dir, area, %{file | "entries" => file["entries"] ++ [new]})
      {:ok, new}
    end
  end

  def record(dir, index, area, "update", %{"id" => id} = changes) do
    with {:ok, file} <- read_area(dir, area),
         {:ok, old} <- find(file, id),
         :ok <-
           if(Map.has_key?(changes, "evidence"),
             do: check_evidence(index, changes["evidence"]),
             else: :ok
           ),
         merged = Map.merge(old, Map.take(changes, ~w(kind audience text evidence prevalence))),
         :ok <- check_enum(merged, "kind", @kinds),
         :ok <- check_enum(merged, "audience", @audiences) do
      entries = Enum.map(file["entries"], &if(&1["id"] == id, do: merged, else: &1))
      write(dir, area, %{file | "entries" => entries})
      {:ok, merged}
    end
  end

  def record(dir, _index, area, "retire", %{"id" => id}) do
    with {:ok, file} <- read_area(dir, area),
         {:ok, old} <- find(file, id) do
      write(dir, area, %{file | "entries" => Enum.reject(file["entries"], &(&1["id"] == id))})
      {:ok, old}
    end
  end

  def record(_dir, _index, _area, op, _entry), do: {:error, "invalid operation: #{inspect(op)}"}

  @spec set_purpose(Path.t(), Index.t(), String.t(), String.t(), String.t()) ::
          :ok | {:error, String.t()}
  def set_purpose(dir, index, area, id, text) do
    with {:ok, file} <- read_area(dir, area),
         :ok <- check_purpose_text(text),
         :ok <-
           if(Map.has_key?(index.functions, id),
             do: :ok,
             else: {:error, "unknown function: #{inspect_id(id)}"}
           ) do
      write(dir, area, %{file | "purposes" => Map.put(file["purposes"], id, text)})
      :ok
    end
  end

  @spec purposes(map()) :: %{String.t() => String.t()}
  def purposes(%{areas: areas}) do
    Enum.reduce(areas, %{}, fn {_, f}, acc -> Map.merge(acc, f["purposes"] || %{}) end)
  end

  @doc "Cited evidence id => texts of the entries citing it."
  @spec pattern_text(map()) :: %{String.t() => [String.t()]}
  def pattern_text(%{areas: areas}) do
    for {_, f} <- areas,
        %{"text" => t} = e when is_binary(t) <- f["entries"],
        id <- e["evidence"],
        reduce: %{} do
      acc -> Map.update(acc, id, [t], &[t | &1])
    end
  end

  @spec stale(map(), Index.t()) :: [map()]
  def stale(%{areas: areas}, index) do
    for {area, f} <- Enum.sort(areas),
        e <- f["entries"],
        missing = Enum.reject(e["evidence"] || [], &known?(index, &1)),
        missing != [],
        do: %{area: area, entry_id: e["id"], missing: missing}
  end

  defp known?(index, ev) do
    Map.has_key?(index.functions, ev) or Enum.any?(Map.keys(index.modules), &(inspect(&1) == ev))
  end

  defp check_evidence(index, [_ | _] = evidence) do
    case Enum.find(evidence, &(not known?(index, &1))) do
      nil -> :ok
      bad -> {:error, "unknown evidence: #{if is_binary(bad), do: bad, else: inspect(bad)}"}
    end
  end

  defp check_evidence(_, _), do: {:error, "evidence must be a non-empty list"}

  defp require_fields(%{"kind" => k, "text" => t, "evidence" => [_ | _] = ev})
       when is_binary(k) and is_binary(t) and t != "" and is_list(ev),
       do: :ok

  defp require_fields(_), do: {:error, "add requires kind, text and non-empty evidence"}

  defp check_enum(entry, key, allowed) do
    if entry[key] in allowed, do: :ok, else: {:error, "invalid #{key}: #{inspect(entry[key])}"}
  end

  defp find(file, id) do
    case Enum.find(file["entries"], &(&1["id"] == id)) do
      nil -> {:error, "unknown entry: #{inspect_id(id)}"}
      e -> {:ok, e}
    end
  end

  defp next_n(entries) do
    entries
    |> Enum.map(fn %{"id" => id} ->
      case Integer.parse(id |> String.split("-") |> List.last()) do
        {n, ""} -> n
        _ -> 0
      end
    end)
    |> Enum.max(fn -> 0 end)
    |> Kernel.+(1)
  end

  defp read_area(dir, area) do
    if is_binary(area) and Regex.match?(~r/\A[A-Za-z0-9_-]+\z/, area) do
      path = path(dir, area)

      if File.exists?(path) do
        case read_file(path) do
          {:ok, f} -> {:ok, Map.merge(f, %{"area" => area, "purposes" => f["purposes"] || %{}})}
          :error -> {:error, "invalid pattern file: #{path}"}
        end
      else
        {:ok, %{"area" => area, "entries" => [], "purposes" => %{}}}
      end
    else
      {:error, "invalid area: #{inspect(area)}"}
    end
  end

  # Shared shape check: map; entries = list of maps with string id and list-of-strings
  # evidence; purposes absent/null/map of string => string.
  defp read_file(path) do
    with {:ok, bin} <- File.read(path),
         {:ok, %{"entries" => es} = f} when is_list(es) <- JSON.decode(bin),
         true <- Enum.all?(es, &valid_entry?/1),
         true <- valid_purposes?(Map.get(f, "purposes")) do
      {:ok, f}
    else
      _ -> :error
    end
  end

  defp valid_entry?(%{"id" => id, "evidence" => ev}),
    do: is_binary(id) and is_list(ev) and Enum.all?(ev, &is_binary/1)

  defp valid_entry?(_), do: false

  defp valid_purposes?(nil), do: true

  defp valid_purposes?(p) when is_map(p),
    do: Enum.all?(p, fn {_, v} -> is_binary(v) end)

  defp valid_purposes?(_), do: false

  defp check_purpose_text(t) when is_binary(t),
    do: if(String.trim(t) == "", do: {:error, "invalid purpose text"}, else: :ok)

  defp check_purpose_text(_), do: {:error, "invalid purpose text"}

  defp inspect_id(id) when is_binary(id), do: id
  defp inspect_id(id), do: inspect(id)

  defp path(dir, area), do: Path.join([dir, "patterns", area <> ".json"])

  defp write(dir, area, file) do
    path = path(dir, area)
    File.mkdir_p!(Path.dirname(path))
    tmp = path <> ".tmp"
    File.write!(tmp, [encode(file, 0), "\n"])
    File.rename!(tmp, path)
  end

  # Tiny pretty-printer with sorted keys (Elixir's JSON does not pretty-print).
  defp encode(map, depth) when is_map(map) and map_size(map) > 0 do
    pad = String.duplicate("  ", depth + 1)

    body =
      map
      |> Enum.sort()
      |> Enum.map_join(",\n", fn {k, v} ->
        [pad, JSON.encode!(to_string(k)), ": ", encode(v, depth + 1)]
      end)

    ["{\n", body, "\n", String.duplicate("  ", depth), "}"]
  end

  defp encode([_ | _] = list, depth) do
    pad = String.duplicate("  ", depth + 1)
    body = Enum.map_join(list, ",\n", &[pad, encode(&1, depth + 1)])
    ["[\n", body, "\n", String.duplicate("  ", depth), "]"]
  end

  defp encode(other, _), do: JSON.encode!(other)
end
