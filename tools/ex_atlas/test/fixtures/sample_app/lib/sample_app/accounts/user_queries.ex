defmodule SampleApp.Accounts.UserQueries do
  @moduledoc "Queries for users."

  alias SampleApp.Repo

  def by_email(email), do: Repo.get(:user, blank_to_nil(email))

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value
end
