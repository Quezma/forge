defmodule SampleApp.Accounts do
  @moduledoc "User accounts."

  alias SampleApp.{Repo, Util}
  alias SampleApp.Accounts.UserQueries

  @doc "Fetch a user by id."
  @spec fetch(term) :: term
  def fetch(id), do: Repo.get(:user, id) |> Util.blank_to_nil()

  def by_email(email), do: UserQueries.by_email(email)
end
