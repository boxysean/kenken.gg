import scala.collection.mutable.HashMap

import org.scalatest.FunSuite

import gg.kenken.solver.Operator
import gg.kenken.solver.Constraint
import gg.kenken.solver.GameState

class GameStateTest extends FunSuite {
  test("GameState.reduceCellPossibilities") {
    /*
      123 aab
      312 cdb
      231 cdb
    */
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).reduceCellPossibilities

    assert(gameState.cellPossibilities(0)(0) === Set(1))
    assert(gameState.cellPossibilities(0)(1) === Set(2))
    assert(gameState.cellPossibilities(0)(2) === Set(3))
    assert(gameState.cellPossibilities(1)(1) === Set(1, 3))
    assert(gameState.cellPossibilities(2)(1) === Set(1, 3))
  }

  test("GameState.cellsWithoutCertainty") {
    /*
      123 aab
      312 cdb
      231 cdb
    */
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).reduceCellPossibilities

    assert(gameState.cellsWithoutCertainty == List(
      (1, 0), (1, 1), (1, 2), (2, 0), (2, 1), (2, 2)
    ))
  }

  test("GameState.isSolved on unsolved board") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    assert(!gameState.isSolved)
  }

  test("GameState.isSolved on solved board") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).solve

    assert(gameState.isSolved)
  }

  test("GameState.isPossible on valid initial board") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    assert(gameState.isPossible)
  }

  test("GameState.allCellsHaveAChoice on initial board") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    assert(gameState.allCellsHaveAChoice)
  }

  test("GameState.clone produces independent copy") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    val cloned = gameState.clone()
    // Modifying the clone should not affect the original
    cloned.cellPossibilities(0)(0) = Set(1)
    assert(gameState.cellPossibilities(0)(0) !== Set(1))
  }

  test("GameState.tryIt sets cell to single value") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    val tried = gameState.tryIt(1, 0, 2)
    assert(tried.cellPossibilities(1)(0) === Set(2))
    // Original should be unmodified
    assert(gameState.cellPossibilities(1)(0).size > 1)
  }

  test("GameState.definitelyNotThis removes value from cell") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    val originalPossibilities = gameState.cellPossibilities(1)(0)
    // Pick a value that is actually in the possibilities set
    val valueToRemove = originalPossibilities.head
    val modified = gameState.definitelyNotThis(1, 0, valueToRemove)
    assert(!modified.cellPossibilities(1)(0).contains(valueToRemove))
    // Original should still contain the value
    assert(originalPossibilities.contains(valueToRemove))
  }

  test("GameState.solve 3x3 addition only") {
    val solved = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).solve

    assert(solved != null)
    assert(solved.isSolved)
    // Verify all cells have exactly one possibility
    for (row <- 0 to 2; col <- 0 to 2) {
      assert(solved.cellPossibilities(row)(col).size === 1)
    }
  }

  test("GameState.solve 3x3 mixed operators") {
    val solved = GameState(List(
      Constraint('a', 6, Operator.Multiplication),
      Constraint('b', 2, Operator.Constant),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 1, Operator.Constant),
      Constraint('e', 1, Operator.Subtraction)
    ), Array(
      Array('a', 'b', 'c'),
      Array('a', 'c', 'c'),
      Array('d', 'e', 'e')
    )).solve

    assert(solved != null)
    assert(solved.isSolved)
  }

  test("GameState.toJson returns correct format") {
    val solved = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).solve

    val json = solved.toJson
    assert(json.length === 3)
    assert(json(0).length === 3)
    // All cells should have numeric values (not ".")
    for (row <- json; cell <- row) {
      assert(cell !== ".")
      assert(cell.toInt >= 1 && cell.toInt <= 3)
    }
  }

  test("GameState.toString for solved board contains no dots") {
    val solved = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )).solve

    assert(!solved.toString.contains("."))
  }

  test("GameState.boardSize") {
    val gameState = GameState(List(
      Constraint('a', 3, Operator.Addition),
      Constraint('b', 6, Operator.Addition),
      Constraint('c', 5, Operator.Addition),
      Constraint('d', 4, Operator.Addition)
    ), Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    ))

    assert(gameState.boardSize === 3)
  }
}
