defmodule ExAtlas.Area do
  @moduledoc """
  Classifies a project-relative source path into a coarse area.

  `lib/<app>/<x>/...` and `lib/<app>/<x>.ex` (when `lib/<app>/<x>/` exists) are
  area `x`; any other `lib/<app>/<x>.ex` is `"core"`; `lib/<app>_web/**` is
  `"web"`; everything else is `"other"`.
  """

  @spec of(String.t(), atom(), (String.t() -> boolean())) :: String.t()
  def of(rel_path, app, dir_exists?) do
    app = Atom.to_string(app)
    web = app <> "_web"

    case Path.split(rel_path) do
      ["lib", ^web | _] -> "web"
      ["lib", ^app, _file] -> file_area(rel_path, app, dir_exists?)
      ["lib", ^app, dir | _] -> dir
      ["lib", file] when file == app <> ".ex" -> "core"
      ["lib", file] when file == web <> ".ex" -> "web"
      _ -> "other"
    end
  end

  defp file_area(rel_path, app, dir_exists?) do
    name = Path.basename(rel_path, ".ex")
    if dir_exists?.(Path.join(["lib", app, name])), do: name, else: "core"
  end
end
