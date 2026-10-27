defmodule ExAtlas.ServerIntegrationTest do
  use ExUnit.Case, async: false

  @moduletag :integration
  @moduletag timeout: 180_000

  @fixture Path.expand("../fixtures/sample_app", __DIR__)

  setup do
    root = Path.join(System.tmp_dir!(), "ex_atlas_srv_#{System.unique_integer([:positive])}")
    File.cp_r!(@fixture, root)
    File.rm_rf!(Path.join(root, ".ex_atlas"))
    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, root: root}
  end

  defp collect(port, buf \\ "") do
    receive do
      {^port, {:data, data}} -> collect(port, buf <> data)
      {^port, {:exit_status, status}} -> {status, buf}
    after
      120_000 -> flunk("server did not exit, stdout so far: #{inspect(buf)}")
    end
  end

  defp serve(root, requests, elixir_args \\ []) do
    input =
      Path.join(System.tmp_dir!(), "ex_atlas_in_#{System.unique_integer([:positive])}.jsonl")

    on_exit(fn -> File.rm(input) end)
    File.write!(input, Enum.map_join(requests, &(JSON.encode!(&1) <> "\n")))

    # Stdin is a file, so the server sees EOF after the last request and exits.
    cmd =
      ~s(input="$2"; ebin="$1"; shift 2; exec "$0" -pa "$ebin" "$@" -S mix ex_atlas.server < "$input")

    port =
      Port.open({:spawn_executable, "/bin/sh"}, [
        :binary,
        :exit_status,
        cd: root,
        env: [{~c"MIX_ENV", ~c"dev"}],
        args:
          ["-c", cmd, System.find_executable("elixir"), Mix.Project.compile_path(), input] ++
            elixir_args
      ])

    {0, out} = collect(port)
    out |> String.split("\n", trim: true) |> Enum.map(&JSON.decode!/1)
  end

  test "every ex_atlas module is loaded at start, so an archive swap cannot mix versions",
       %{root: root} do
    out = Path.join(root, "not_loaded.etf")

    # Runs after the server exits on EOF; only initialize was served, so lazy loading
    # would leave most modules (Search, Index, ...) unloaded.
    hook = ~s|System.at_exit(fn _ ->
      Application.load(:ex_atlas)
      mods = Application.spec(:ex_atlas, :modules)
      File.write!(#{inspect(out)}, :erlang.term_to_binary(Enum.reject(mods, &:code.is_loaded/1)))
    end)|

    serve(root, [init()], ["-e", hook])
    assert out |> File.read!() |> :erlang.binary_to_term() == []
  end

  defp init,
    do: %{jsonrpc: "2.0", id: 1, method: "initialize", params: %{protocolVersion: "2025-06-18"}}

  test "stdout carries only JSON-RPC replies; the first tool call builds the index", %{root: root} do
    call = %{
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: %{name: "find_reusable", arguments: %{query: "blank to nil é"}}
    }

    replies = serve(root, [init(), call])

    assert [
             %{"id" => 1, "result" => %{"serverInfo" => %{"name" => "ex_atlas"}}},
             %{"id" => 2} = second
           ] =
             replies

    assert hd(second["result"]["content"])["text"] =~ "blank_to_nil"
    assert File.exists?(Path.join(root, ".ex_atlas/index.etf"))
  end

  test "initialize and tools/list neither index nor compile", %{root: root} do
    replies = serve(root, [init(), %{jsonrpc: "2.0", id: 2, method: "tools/list"}])
    assert [%{"id" => 1}, %{"id" => 2, "result" => %{"tools" => [_ | _]}}] = replies
    refute File.exists?(Path.join(root, ".ex_atlas"))
    refute File.exists?(Path.join(root, "_build"))
  end

  test "a saved index is loaded without compiling", %{root: root} do
    fx = %{
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: %{name: "find_reusable", arguments: %{query: "blank to nil"}}
    }

    serve(root, [init(), fx])
    File.rm_rf!(Path.join(root, "_build"))

    assert [_, %{"id" => 2}] = serve(root, [init(), fx])
    refute File.exists?(Path.join(root, "_build"))
  end
end
