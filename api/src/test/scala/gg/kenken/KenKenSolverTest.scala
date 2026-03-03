import org.scalatest.FunSuite

import gg.kenken.KenKenSolver
import gg.kenken.KenKenSolverException
import gg.kenken.solver.Operator
import gg.kenken.solver.Constraint

class KenKenSolverTest extends FunSuite {
  test("KenKenSolver.parseConstraintLine with addition") {
    val constraints = KenKenSolver.parseConstraintLine("a=3+ b=6+")
    assert(constraints.length === 2)
    assert(constraints(0).name === 'a')
    assert(constraints(0).value === 3)
    assert(constraints(0).operator === Operator.Addition)
    assert(constraints(1).name === 'b')
    assert(constraints(1).value === 6)
    assert(constraints(1).operator === Operator.Addition)
  }

  test("KenKenSolver.parseConstraintLine with all operators") {
    val constraints = KenKenSolver.parseConstraintLine("a=60x b=4+ c=3- d=2/ e=5")
    assert(constraints.length === 5)
    assert(constraints(0).operator === Operator.Multiplication)
    assert(constraints(1).operator === Operator.Addition)
    assert(constraints(2).operator === Operator.Subtraction)
    assert(constraints(3).operator === Operator.Division)
    assert(constraints(4).operator === Operator.Constant)
  }

  test("KenKenSolver.parseConstraintLine with constant") {
    val constraints = KenKenSolver.parseConstraintLine("a=5")
    assert(constraints.length === 1)
    assert(constraints(0).name === 'a')
    assert(constraints(0).value === 5)
    assert(constraints(0).operator === Operator.Constant)
  }

  test("KenKenSolver.parseBoard 3x3") {
    val board = KenKenSolver.parseBoard(Iterator("a a b", "c d b", "c d b"))
    assert(board.length === 3)
    assert(board(0).length === 3)
    assert(board(0)(0) === 'a')
    assert(board(0)(1) === 'a')
    assert(board(0)(2) === 'b')
    assert(board(1)(0) === 'c')
    assert(board(2)(2) === 'b')
  }

  test("KenKenSolver.parseBoard 5x5") {
    val board = KenKenSolver.parseBoard(Iterator(
      "a b b c d",
      "e e f c d",
      "g f f c h",
      "g i j h h",
      "k k j j l"
    ))
    assert(board.length === 5)
    assert(board(0).length === 5)
    assert(board(0)(0) === 'a')
    assert(board(4)(4) === 'l')
  }

  test("KenKenSolver.solveFromAPI 3x3") {
    val result = KenKenSolver.solveFromAPI(
      Iterator("a a b", "c d b", "c d b"),
      "a=3+ b=6+ c=5+ d=4+"
    )
    assert(result === "1 2 3\n2 3 1\n3 1 2")
  }

  test("KenKenSolver.solveFromAPI 3x3 with multiplication") {
    val result = KenKenSolver.solveFromAPI(
      Iterator("a b c", "a c c", "d e e"),
      "a=6x b=2 c=5+ d=1 e=1-"
    )
    // Should produce a valid solved board
    assert(!result.contains("."))
    // Verify it's a 3x3 grid
    val rows = result.split("\n")
    assert(rows.length === 3)
    rows.foreach(row => assert(row.split(" ").length === 3))
  }

  test("KenKenSolver.parseFile kenken2") {
    val gameState = KenKenSolver.parseFile("input/kenken2.in")
    assert(gameState.boardSize === 3)
    assert(gameState.board(0)(0) === 'a')
    assert(gameState.constraints.contains('a'))
    assert(gameState.constraints.contains('b'))
    assert(gameState.constraints.contains('c'))
    assert(gameState.constraints.contains('d'))
  }

  test("KenKenSolver.parseFile kenken3") {
    val gameState = KenKenSolver.parseFile("input/kenken3.in")
    assert(gameState.boardSize === 3)
    assert(gameState.constraints('a').operator === Operator.Multiplication)
    assert(gameState.constraints('b').operator === Operator.Constant)
    assert(gameState.constraints('b').value === 2)
  }

  test("KenKenSolver.parseConstraintLine throws on invalid token") {
    assertThrows[KenKenSolverException] {
      KenKenSolver.parseConstraintLine("invalid_token")
    }
  }
}
