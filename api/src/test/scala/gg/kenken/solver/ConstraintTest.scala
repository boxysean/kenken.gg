import org.scalatest.FunSuite

import gg.kenken.solver.Operator
import gg.kenken.solver.Constraint

class ConstraintTest extends FunSuite {
  test("Constraint.toString") {
    val c = Constraint('a', 3, Operator.Addition)
    assert(c.toString === "a=3+")
  }

  test("Constraint.toString for constant") {
    val c = Constraint('b', 5, Operator.Constant)
    assert(c.toString === "b=5")
  }

  test("Constraint.toString for multiplication") {
    val c = Constraint('c', 60, Operator.Multiplication)
    assert(c.toString === "c=60x")
  }

  test("Constraint.getConstraintCellLocations for single cell") {
    val board = Array(
      Array('a', 'b'),
      Array('c', 'd')
    )
    val c = Constraint('a', 5, Operator.Constant)
    val locations = c.getConstraintCellLocations(board, 0, 0)
    assert(locations === List((0, 0)))
  }

  test("Constraint.getConstraintCellLocations for horizontal pair") {
    val board = Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )
    val c = Constraint('a', 3, Operator.Addition)
    val locations = c.getConstraintCellLocations(board, 0, 0)
    assert(locations.toSet === Set((0, 0), (0, 1)))
  }

  test("Constraint.getConstraintCellLocations for vertical group") {
    val board = Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )
    val c = Constraint('b', 6, Operator.Addition)
    val locations = c.getConstraintCellLocations(board, 0, 2)
    assert(locations.toSet === Set((0, 2), (1, 2), (2, 2)))
  }

  test("Constraint.getConstraintCellLocations for L-shaped group") {
    val board = Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )
    val c = Constraint('c', 5, Operator.Addition)
    val locations = c.getConstraintCellLocations(board, 1, 0)
    assert(locations.toSet === Set((1, 0), (2, 0)))
  }

  test("Constraint.getGameConstraintState") {
    val board = Array(
      Array('a', 'a', 'b'),
      Array('c', 'd', 'b'),
      Array('c', 'd', 'b')
    )
    val c = Constraint('a', 3, Operator.Addition)
    val gcs = c.getGameConstraintState(board)
    assert(gcs.name === 'a')
    assert(gcs.value === 3)
    assert(gcs.operator === Operator.Addition)
    assert(gcs.cellLocations.toSet === Set((0, 0), (0, 1)))
    assert(gcs.constraintSize === 2)
    // For a 3x3 board with addition target 3, combinations should include pairs that sum to 3
    assert(gcs.possibleCombinations.contains(List(1, 2)))
  }

  test("Constraint.getGameConstraintState for constant") {
    val board = Array(
      Array('a', 'b', 'c'),
      Array('d', 'e', 'f'),
      Array('g', 'h', 'i')
    )
    val c = Constraint('e', 5, Operator.Constant)
    val gcs = c.getGameConstraintState(board)
    assert(gcs.cellLocations === List((1, 1)))
    assert(gcs.possibleCombinations === List(List(5)))
  }
}
