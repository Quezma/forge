defmodule SampleApp.Util do
  @moduledoc "Shared helpers."

  def blank_to_nil(""), do: nil
  def blank_to_nil(value), do: value
end
