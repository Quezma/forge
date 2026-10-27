defmodule ExAtlas.Source do
  @moduledoc """
  AST-only fallback: lists definitions of a source file without compiling it.
  """

  @kinds [:def, :defp, :defmacro, :defmacrop]

  @spec definitions(String.t()) :: [map()]
  def definitions(path) do
    with {:ok, src} <- File.read(path),
         {:ok, ast} <- Code.string_to_quoted(src, columns: false) do
      ast |> walk([]) |> dedupe()
    else
      _ -> []
    end
  rescue
    # Module.concat/1 on non-atom parts such as `__MODULE__.Foo`.
    _ -> []
  end

  # ponytail: invalid source or dynamic module names yield [] (no partial recovery), fine for a degraded fallback.
  defp walk({:defmodule, _, [{:__aliases__, _, parts}, [do: body]]}, acc) do
    walk_body(body, parts, acc)
  end

  defp walk({:__block__, _, exprs}, acc), do: Enum.reduce(exprs, acc, &walk/2)
  defp walk(_, acc), do: acc

  defp walk_body({:__block__, _, exprs}, parts, acc),
    do: Enum.reduce(exprs, acc, &body_expr(&1, parts, &2))

  defp walk_body(expr, parts, acc), do: body_expr(expr, parts, acc)

  defp body_expr({:defmodule, _, [{:__aliases__, _, sub}, [do: body]]}, parts, acc),
    do: walk_body(body, parts ++ sub, acc)

  defp body_expr({kind, meta, [head | _]}, parts, acc) when kind in @kinds do
    case head_name(head) do
      {name, arity} ->
        [
          %{module: Module.concat(parts), name: name, arity: arity, kind: kind, line: meta[:line]}
          | acc
        ]

      nil ->
        acc
    end
  end

  defp body_expr(_, _, acc), do: acc

  defp head_name({:when, _, [head | _]}), do: head_name(head)
  defp head_name({name, _, args}) when is_atom(name) and is_list(args), do: {name, length(args)}
  defp head_name({name, _, ctx}) when is_atom(name) and is_atom(ctx), do: {name, 0}
  defp head_name(_), do: nil

  # A head with default args counts once, at its full arity; clauses of one function collapse.
  defp dedupe(defs) do
    defs
    |> Enum.sort_by(& &1.line)
    |> Enum.uniq_by(&{&1.module, &1.name, &1.arity, &1.kind})
    |> Enum.sort_by(&{&1.line, &1.name})
  end
end
