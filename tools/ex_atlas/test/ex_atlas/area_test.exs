defmodule ExAtlas.AreaTest do
  use ExUnit.Case, async: true

  alias ExAtlas.Area

  test "classifies paths into areas" do
    dirs = &(&1 in ["lib/my_app/payroll"])

    assert Area.of("lib/my_app/payroll/run.ex", :my_app, dirs) == "payroll"
    assert Area.of("lib/my_app/payroll.ex", :my_app, dirs) == "payroll"
    assert Area.of("lib/my_app/repo.ex", :my_app, dirs) == "core"
    assert Area.of("lib/my_app.ex", :my_app, dirs) == "core"
    assert Area.of("lib/my_app_web.ex", :my_app, dirs) == "web"
    assert Area.of("lib/my_app_web/controllers/x.ex", :my_app, dirs) == "web"
    assert Area.of("lib/mix/tasks/seed.ex", :my_app, dirs) == "other"
  end
end
