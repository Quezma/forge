defmodule ExAtlas.CompileHelper do
  @moduledoc false
  # Compiles source into a beam binary with explicit debug_info/docs options,
  # since `mix test` defaults them to false. Compiler output is swallowed.

  def compile(source, debug_info, file \\ "nofile") do
    prev = Map.take(Code.compiler_options(), [:debug_info, :docs]) |> Map.to_list()
    Code.compiler_options(debug_info: debug_info, docs: true)

    try do
      ExUnit.CaptureIO.capture_io(:stderr, fn ->
        send(self(), {:mods, Code.compile_string(source, file)})
      end)

      receive do
        {:mods, [{_mod, bin}]} -> bin
      end
    after
      Code.compiler_options(prev)
    end
  end
end
