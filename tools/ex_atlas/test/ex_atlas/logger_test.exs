defmodule ExAtlas.LoggerTest do
  use ExUnit.Case, async: false

  setup do
    {:ok, original} = :logger.get_handler_config(:default)

    on_exit(fn ->
      :logger.remove_handler(:default)

      :logger.add_handler(
        :default,
        original.module,
        Map.delete(original, :module) |> Map.delete(:id)
      )
    end)
  end

  test "logger_to_stderr moves the default handler to standard_error" do
    assert :ok = Mix.Tasks.ExAtlas.Server.logger_to_stderr()
    assert {:ok, %{config: %{type: :standard_error}}} = :logger.get_handler_config(:default)
  end
end
