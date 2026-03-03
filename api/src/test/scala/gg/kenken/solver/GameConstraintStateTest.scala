import scala.collection.mutable.HashMap

import org.scalatest.FunSuite

import gg.kenken.solver.Operator
import gg.kenken.solver.Constraint
import gg.kenken.solver.GameState

class GameConstraintStateTest extends FunSuite {
  test("GameConstraintState.placementIsLegal") {
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

    assert(gameState.constraints('a').placementIsLegal(gameState))
  }

  test("GameConstraintState.constraintSize") {
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

    assert(gameState.constraints('a').constraintSize === 2)
    assert(gameState.constraints('b').constraintSize === 3)
    assert(gameState.constraints('c').constraintSize === 2)
    assert(gameState.constraints('d').constraintSize === 2)
  }

  test("GameConstraintState.possibleValuesOfCell") {
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

    // Constraint 'a' is a 2-cell addition to 3 on a 3x3 board
    // Possible combination is (1,2), so possible values are {1, 2}
    assert(gameState.constraints('a').possibleValuesOfCell === Set(1, 2))
  }

  test("GameConstraintState.isFullyPlaced on unsolved board") {
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

    // On initial board, not all cells are fully placed
    assert(!gameState.constraints('b').isFullyPlaced(gameState))
  }

  test("GameConstraintState.isFullyPlaced on solved board") {
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

    assert(solved.constraints('a').isFullyPlaced(solved))
    assert(solved.constraints('b').isFullyPlaced(solved))
    assert(solved.constraints('c').isFullyPlaced(solved))
    assert(solved.constraints('d').isFullyPlaced(solved))
  }
}
