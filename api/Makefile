SCALA_FILES=$(shell find src -name '*.scala')
BIG_FAT_JAR="target/scala-2.13/kenkengg-assembly-1.0.jar"

.PHONY: run
run:
	sbt run

.PHONY: test
test:
	sbt test

$(BIG_FAT_JAR): $(SCALA_FILES)
	sbt assembly
