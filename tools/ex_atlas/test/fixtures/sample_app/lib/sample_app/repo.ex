defmodule SampleApp.Repo do
  @moduledoc "Plain in-memory stand-in for a repo."

  def get(_schema, id), do: id
end
