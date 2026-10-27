defmodule ExAtlas.MCPTest do
  use ExUnit.Case, async: false

  alias ExAtlas.{Indexer, MCP}

  @fixture Path.expand("../fixtures/sample_app", __DIR__)

  setup_all do
    root = Path.join(System.tmp_dir!(), "ex_atlas_mcp_#{System.unique_integer([:positive])}")
    File.cp_r!(@fixture, root)
    File.rm_rf!(Path.join(root, ".ex_atlas"))
    on_exit(fn -> File.rm_rf!(root) end)

    ExUnit.CaptureIO.capture_io(:stderr, fn ->
      send(self(), {:result, Indexer.run(root)})
    end)

    {:ok, index, _} =
      receive do
        {:result, r} -> r
      end

    {:ok, root: root, index: index}
  end

  setup %{root: root, index: index} do
    File.rm_rf!(Path.join(root, ".ex_atlas/usage.jsonl"))

    {:ok,
     state: %{root: root, dir: Path.join(root, ".ex_atlas"), index: index, initialized?: false}}
  end

  defp req(id, method, params \\ %{}),
    do: JSON.encode!(%{jsonrpc: "2.0", id: id, method: method, params: params})

  defp call(state, line) do
    {reply, state} = MCP.handle(line, state)
    {reply && JSON.decode!(reply), state}
  end

  defp tool(state, name, args),
    do: call(state, req(1, "tools/call", %{name: name, arguments: args}))

  test "initialize echoes the protocol version", %{state: state} do
    {reply, state} = call(state, req(1, "initialize", %{protocolVersion: "2024-11-05"}))
    assert reply["result"]["protocolVersion"] == "2024-11-05"
    assert reply["result"]["capabilities"] == %{"tools" => %{}}
    assert reply["result"]["serverInfo"]["name"] == "ex_atlas"
    assert state.initialized?
  end

  test "initialize defaults the protocol version", %{state: state} do
    {reply, _} = call(state, req(1, "initialize"))
    assert reply["result"]["protocolVersion"] == "2025-06-18"
  end

  test "notifications get no reply and ping works", %{state: state} do
    assert {nil, _} =
             MCP.handle(~s({"jsonrpc":"2.0","method":"notifications/initialized"}), state)

    {reply, _} = call(state, req(2, "ping"))
    assert reply["result"] == %{}
    assert reply["id"] == 2
  end

  test "tools/list returns all 8 tools", %{state: state} do
    {reply, _} = call(state, req(1, "tools/list"))
    tools = reply["result"]["tools"]

    assert Enum.sort(Enum.map(tools, & &1["name"])) ==
             Enum.sort(
               ~w(context_for_task find_reusable module callers reindex record_pattern set_purpose record_learning)
             )

    assert Enum.all?(
             tools,
             &(&1["inputSchema"]["type"] == "object" and is_binary(&1["description"]))
           )

    ctx = Enum.find(tools, &(&1["name"] == "context_for_task"))

    assert ctx["description"] =~
             "Call BEFORE implementing anything: returns the project's architecture rules and the patterns for the areas you will touch."

    fr = Enum.find(tools, &(&1["name"] == "find_reusable"))

    assert fr["description"] =~
             "Call before writing any new function: finds existing functions that already do it."
  end

  test "unparseable line is -32700 and state is unchanged", %{state: state} do
    {reply, new_state} = call(state, "{bad")
    assert reply["error"]["code"] == -32700
    assert reply["id"] == nil
    assert new_state == state
  end

  test "unknown method is -32601", %{state: state} do
    {reply, _} = call(state, req(7, "nope"))
    assert reply["error"]["code"] == -32601
    assert reply["id"] == 7
  end

  test "unknown tool is a tool error", %{state: state} do
    {reply, _} = tool(state, "nope", %{})
    assert reply["result"]["isError"] == true
  end

  test "missing or mistyped args are -32602", %{state: state} do
    {reply, _} = tool(state, "find_reusable", %{})
    assert reply["error"]["code"] == -32602
    {reply, _} = tool(state, "find_reusable", %{query: 5})
    assert reply["error"]["code"] == -32602
    {reply, _} = tool(state, "find_reusable", %{query: "x", limit: "ten"})
    assert reply["error"]["code"] == -32602
    {reply, _} = tool(state, "context_for_task", %{task: "t", areas: "accounts"})
    assert reply["error"]["code"] == -32602
  end

  test "find_reusable finds the function and appends one usage line", %{state: state, root: root} do
    {reply, _} = tool(state, "find_reusable", %{query: "blank to nil"})
    refute reply["result"]["isError"]
    [%{"type" => "text", "text" => text}] = reply["result"]["content"]
    assert text =~ "blank_to_nil"

    lines = File.read!(Path.join(root, ".ex_atlas/usage.jsonl")) |> String.split("\n", trim: true)
    assert [line] = lines
    assert %{"tool" => "find_reusable", "results" => ids} = JSON.decode!(line)
    assert "SampleApp.Util.blank_to_nil/1" in ids
  end

  test "find_reusable sees a purpose set after its corpus was cached", %{state: state} do
    on_exit(fn -> File.rm_rf!(Path.join(state.dir, "patterns/zz.json")) end)
    ids = fn reply -> JSON.decode!(hd(reply["result"]["content"])["text"])["results"] end

    {reply, state} = tool(state, "find_reusable", %{query: "zebra striped"})
    assert ids.(reply) == []

    {_, state} =
      tool(state, "set_purpose", %{
        area: "zz",
        id: "SampleApp.Util.blank_to_nil/1",
        text: "zebra striped"
      })

    {reply, _} = tool(state, "find_reusable", %{query: "zebra striped"})
    assert [%{"id" => "SampleApp.Util.blank_to_nil/1"}] = ids.(reply)
  end

  test "context_for_task returns context and logs usage", %{state: state, root: root} do
    {reply, _} =
      tool(state, "context_for_task", %{task: "add user", areas: ["accounts"], budget: 4000})

    refute reply["result"]["isError"]
    [%{"text" => text}] = reply["result"]["content"]
    assert %{"task" => "add user"} = JSON.decode!(text)
    assert File.exists?(Path.join(root, ".ex_atlas/usage.jsonl"))
  end

  test "module lists functions; unknown module is a tool error", %{state: state} do
    {reply, _} = tool(state, "module", %{name: "SampleApp.Util"})
    [%{"text" => text}] = reply["result"]["content"]
    assert %{"functions" => [%{"id" => "SampleApp.Util.blank_to_nil/1"} | _]} = JSON.decode!(text)
    {reply, _} = tool(state, "module", %{name: "Nope.Missing"})
    assert reply["result"]["isError"] == true
  end

  test "callers returns file:line and tolerates unknown ids", %{state: state} do
    {reply, _} = tool(state, "callers", %{id: "SampleApp.Util.blank_to_nil/1"})
    [%{"text" => text}] = reply["result"]["content"]
    assert %{"callers" => callers} = JSON.decode!(text)
    assert Enum.all?(callers, &(is_binary(&1["id"]) and &1["file"] =~ "lib/"))
    {reply, _} = tool(state, "callers", %{id: "No.such/0"})
    assert JSON.decode!(hd(reply["result"]["content"])["text"])["callers"] == []
  end

  test "set_purpose and record_pattern surface client errors as tool errors", %{state: state} do
    {reply, _} = tool(state, "set_purpose", %{area: "accounts", id: "No.such/0", text: "x"})
    assert reply["result"]["isError"] == true
    {reply, _} = tool(state, "record_pattern", %{area: "accounts", op: "add", entry: %{}})
    assert reply["result"]["isError"] == true
  end

  test "record_learning rejects an invalid learning without dying", %{state: state} do
    {reply, _} = tool(state, "record_learning", %{})
    assert reply["error"]["code"] == -32602

    bad = ~w(project branch cause query expected evidence) |> Map.new(&{&1, "x"})
    bad = Map.merge(bad, %{"tool" => "module", "actual" => 3})
    {reply, _} = tool(state, "record_learning", bad)
    assert reply["result"]["isError"] == true
  end

  test "record_learning schema requires every key the store requires and declares args" do
    %{"inputSchema" => schema} =
      Enum.find(ExAtlas.Tools.list(), &(&1["name"] == "record_learning"))

    assert Enum.sort(schema["required"]) ==
             ~w(actual branch cause evidence expected project query tool)

    assert schema["properties"]["args"] == %{"type" => "object"}
  end

  test "client error responses are ignored", %{state: state} do
    assert {nil, ^state} =
             MCP.handle(~s({"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"x"}}), state)
  end

  test "record_pattern writes .ex_atlas/patterns/<area>.json and context returns it", %{
    state: state,
    root: root
  } do
    entry = %{
      kind: "rule",
      text: "Use Util.blank_to_nil/1 for blank strings",
      evidence: ["SampleApp.Util.blank_to_nil/1"]
    }

    {reply, state} = tool(state, "record_pattern", %{area: "accounts", op: "add", entry: entry})
    refute reply["result"]["isError"]
    assert File.exists?(Path.join(root, ".ex_atlas/patterns/accounts.json"))
    refute File.exists?(Path.join(root, ".ex_atlas/patterns/patterns"))

    {reply, _} = tool(state, "context_for_task", %{task: "t", areas: ["accounts"]})
    assert hd(reply["result"]["content"])["text"] =~ "Use Util.blank_to_nil/1 for blank strings"
  end

  test "safely turns throw and exit into errors" do
    assert {:error, "throw: :boom"} = ExAtlas.Tools.safely(fn -> throw(:boom) end)
    assert {:error, "exit: :boom"} = ExAtlas.Tools.safely(fn -> exit(:boom) end)
  end

  test "a tool failure never escapes handle/2", %{state: state} do
    bad = %{state | index: %{modules: 5}}
    {reply, _} = tool(bad, "module", %{name: "SampleApp.Util"})
    assert reply["result"]["isError"] == true
  end

  @tag :integration
  test "reindex picks up a new function", %{state: state} do
    File.write!(
      Path.join(state.root, "lib/sample_app/util.ex"),
      """
      defmodule SampleApp.Util do
        @moduledoc "Shared helpers."

        def blank_to_nil(""), do: nil
        def blank_to_nil(value), do: value
        def freshly_added(x), do: x
      end
      """
    )

    {_, state} = tool(state, "find_reusable", %{query: "freshly added"})

    ExUnit.CaptureIO.capture_io(:stderr, fn -> send(self(), {:r, tool(state, "reindex", %{})}) end)

    {reply, new_state} =
      receive do
        {:r, r} -> r
      end

    assert %{"changed_files" => files, "stale" => stale, "degraded" => false} =
             JSON.decode!(hd(reply["result"]["content"])["text"])

    assert is_list(stale)
    assert "lib/sample_app/util.ex" in files
    assert Map.has_key?(new_state.index.functions, "SampleApp.Util.freshly_added/1")
    refute Map.has_key?(state.index.functions, "SampleApp.Util.freshly_added/1")

    {reply, _} = tool(new_state, "find_reusable", %{query: "freshly added"})
    assert hd(reply["result"]["content"])["text"] =~ "SampleApp.Util.freshly_added/1"
  end
end
