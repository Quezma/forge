defmodule SampleApp.MixProject do
  use Mix.Project

  def project do
    [
      app: :sample_app,
      version: "0.1.0",
      elixir: "~> 1.18",
      elixirc_options: [debug_info: true, docs: true],
      deps: []
    ]
  end

  def application, do: []
end
