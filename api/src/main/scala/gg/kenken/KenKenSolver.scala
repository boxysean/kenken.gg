package gg.kenken

import scala.io.Source
import scala.language.reflectiveCalls
import scala.collection.mutable.HashMap
import scala.util.matching.Regex

import com.typesafe.scalalogging.LazyLogging

import gg.kenken.solver._


object Control {
  def using[A <: { def close(): Unit }, B](resource: A)(f: A => B): B =
    try {
      f(resource)
    } finally {
      resource.close()
    }
}

object KenKenSolver extends LazyLogging {
  def parseConstraintLine(constraintLine: String): List[Constraint] = {
    val constraintBlobPattern: Regex = "([^=]*)=([0-9]+)([\\+\\-x/\\.]?)".r

    constraintLine.split(" ").map(token => token match {
      case constraintBlobPattern(name, value, operator) => new Constraint(name(0), value.toInt, Operator.withName(operator))
      case _ => throw new KenKenSolverException("Error parsing token " + token)
    }).toList
  }

  def parseBoard(boardLines: Iterator[String]): Array[Array[Char]] =
    boardLines.map(line =>
      line.split(" ").map(charStr =>
        charStr(0)
      )
    ).toArray

  def parseFile(fileName: String): GameState = {
    Control.using(Source.fromFile(fileName)) { source =>
      var lines = source.getLines
      return GameState(parseConstraintLine(lines.next), parseBoard(lines))
    }
  }

  def solveFromAPI(boardStrings: Iterator[String], constraintString: String): String =
    GameState(parseConstraintLine(constraintString), parseBoard(boardStrings))
      .solve
      .toString

  def main(args: Array[String]): Unit = {
    var gameState = this.parseFile("input/kenken3.in")
    logger.info("{}", gameState.constraintsToString)
    logger.info("{}", gameState.boardToString)
    val theSolvedBoard = gameState.solve
    logger.info("SOLVED ಡ_ಡ")
    logger.info("{}", theSolvedBoard)
  }
}
