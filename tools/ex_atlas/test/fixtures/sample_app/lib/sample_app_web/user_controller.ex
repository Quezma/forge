defmodule SampleAppWeb.UserController do
  @moduledoc "Serves users."

  alias SampleApp.Accounts

  def show(id), do: id |> blank_to_nil() |> Accounts.fetch()

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value
end
