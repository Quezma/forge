defmodule ExAtlas.MCP do
  @moduledoc "Pure JSON-RPC 2.0 handler for the MCP stdio protocol."

  alias ExAtlas.Tools

  @version Mix.Project.config()[:version]
  @default_protocol "2025-06-18"

  @type state :: %{
          required(:root) => Path.t(),
          required(:dir) => Path.t(),
          required(:index) => ExAtlas.Index.t() | nil,
          required(:initialized?) => boolean(),
          optional(:loader) => (-> ExAtlas.Index.t()),
          optional(:search) => {non_neg_integer(), map()}
        }

  @spec handle(String.t(), state()) :: {String.t() | nil, state()}
  def handle(line, state) do
    case JSON.decode(line) do
      {:ok, %{"method" => method} = msg} when is_binary(method) ->
        dispatch(method, msg["params"] || %{}, msg, state)

      {:ok, %{"result" => _}} ->
        {nil, state}

      {:ok, %{"error" => _}} ->
        {nil, state}

      {:ok, _} ->
        {error(nil, -32600, "invalid request"), state}

      {:error, _} ->
        {error(nil, -32700, "parse error"), state}
    end
  rescue
    e -> {error(nil, -32603, "internal error: " <> Exception.message(e)), state}
  catch
    kind, reason -> {error(nil, -32603, "internal error: #{kind}: #{inspect(reason)}"), state}
  end

  defp dispatch("notifications/initialized", _, _, state),
    do: {nil, %{state | initialized?: true}}

  defp dispatch(_, _, %{"id" => id}, state) when not is_binary(id) and not is_number(id),
    do: {error(nil, -32600, "invalid request"), state}

  defp dispatch(_, _, msg, state) when not is_map_key(msg, "id"), do: {nil, state}

  defp dispatch("initialize", params, %{"id" => id}, state) do
    version = if is_map(params), do: params["protocolVersion"], else: nil

    {ok(id, %{
       protocolVersion: version || @default_protocol,
       capabilities: %{tools: %{}},
       serverInfo: %{name: "ex_atlas", version: @version}
     }), %{state | initialized?: true}}
  end

  defp dispatch("ping", _, %{"id" => id}, state), do: {ok(id, %{}), state}

  defp dispatch("tools/list", _, %{"id" => id}, state),
    do: {ok(id, %{tools: Tools.list()}), state}

  defp dispatch("tools/call", %{"name" => name} = params, %{"id" => id}, state)
       when is_binary(name) do
    args = Map.get(params, "arguments", %{})

    with true <- is_map(args),
         :ok <- Tools.validate(name, args) do
      case Tools.call(name, args, state) do
        {:ok, payload, state} -> {ok(id, content(payload, false)), state}
        {:error, msg} -> {ok(id, content(%{error: msg}, true)), state}
      end
    else
      false -> {error(id, -32602, "arguments must be an object"), state}
      {:error, msg} -> {error(id, -32602, msg), state}
    end
  end

  defp dispatch("tools/call", _, %{"id" => id}, state),
    do: {error(id, -32602, "missing tool name"), state}

  defp dispatch(method, _, %{"id" => id}, state),
    do: {error(id, -32601, "method not found: #{method}"), state}

  defp content(payload, error?) do
    base = %{content: [%{type: "text", text: JSON.encode!(payload)}]}
    if error?, do: Map.put(base, :isError, true), else: base
  end

  defp ok(id, result), do: JSON.encode!(%{jsonrpc: "2.0", id: id, result: result})

  defp error(id, code, message),
    do: JSON.encode!(%{jsonrpc: "2.0", id: id, error: %{code: code, message: message}})
end
