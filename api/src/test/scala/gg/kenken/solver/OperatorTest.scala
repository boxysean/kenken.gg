import org.scalatest.FunSuite

import gg.kenken.solver.Operator

class OperatorTest extends FunSuite {
  test("Operator.withName for all operators") {
    assert(Operator.withName("+") === Operator.Addition)
    assert(Operator.withName("-") === Operator.Subtraction)
    assert(Operator.withName("x") === Operator.Multiplication)
    assert(Operator.withName("/") === Operator.Division)
    assert(Operator.withName("") === Operator.Constant)
  }

  test("Operator.toString") {
    assert(Operator.Addition.toString === "+")
    assert(Operator.Subtraction.toString === "-")
    assert(Operator.Multiplication.toString === "x")
    assert(Operator.Division.toString === "/")
    assert(Operator.Constant.toString === "")
  }
}
