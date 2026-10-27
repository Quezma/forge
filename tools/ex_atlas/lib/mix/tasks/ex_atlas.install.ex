defmodule Mix.Tasks.ExAtlas.Install do
  @shortdoc "Sets up ex_atlas in the current project (gitignore, AGENTS.md)"
  @moduledoc """
  Run in a project root. Creates `.ex_atlas/.gitignore` (index ignored, `patterns/` committed),
  adds the agent instructions to `AGENTS.md` between `ex_atlas` markers (idempotent), and prints
  the `claude mcp add` command to register the server. Accepts an optional directory argument.
  """

  use Mix.Task

  @start "<!-- ex_atlas:start -->"
  @end_ "<!-- ex_atlas:end -->"

  # Embedded at compile time so the archive needs no runtime priv lookup.
  @snippet_path Path.expand("../../../priv/agents_snippet.md", __DIR__)
  @external_resource @snippet_path
  @snippet File.read!(@snippet_path)

  @impl Mix.Task
  def run(args) do
    root = List.first(args) || File.cwd!()

    File.dir?(root) || Mix.raise("not a directory: #{root}")
    ExAtlas.Index.ensure_dir(Path.join(root, ".ex_atlas"))

    agents = Path.join(root, "AGENTS.md")
    existing = if File.exists?(agents), do: File.read!(agents), else: ""
    File.write!(agents, put_block(existing))

    warn_claude_md(root)

    IO.puts("""
    ex_atlas installed. Build the index once (the server never compiles at startup):

        mix ex_atlas.index

    Then register the MCP server by running this in the project root:

        claude mcp add ex_atlas -- mix ex_atlas.server
    """)
  end

  # Claude Code reads CLAUDE.md, not AGENTS.md, unless CLAUDE.md imports it.
  defp warn_claude_md(root) do
    claude = Path.join(root, "CLAUDE.md")

    if File.exists?(claude) and not (File.read!(claude) =~ "@AGENTS.md") do
      IO.puts("""
      warning: CLAUDE.md does not import AGENTS.md, so Claude Code will not see the ex_atlas
      instructions. Add a line containing `@AGENTS.md` to CLAUDE.md.
      """)
    end
  end

  defp put_block(text) do
    block = "#{@start}\n#{String.trim(@snippet)}\n#{@end_}"
    pattern = ~r/#{Regex.escape(@start)}.*?#{Regex.escape(@end_)}/s

    cond do
      Regex.match?(pattern, text) -> Regex.replace(pattern, text, fn _ -> block end)
      text == "" -> block <> "\n"
      true -> String.trim_trailing(text) <> "\n\n" <> block <> "\n"
    end
  end
end
