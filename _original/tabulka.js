document.addEventListener("DOMContentLoaded", function () {
  const table = document.getElementById("bonusTable");

  const cells = document.querySelectorAll("td[contenteditable]");
  const validNumbers = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]);
  
  cells.forEach(cell => {
    let isEdited = false;
  
    cell.addEventListener("input", function handleInput() {
      const cellValue = this.textContent.trim();
      if (!validNumbers.has(cellValue) && cellValue !== "") {
        this.textContent = "";
      }
      isEdited = true;
    });
  
    cell.addEventListener("blur", function handleBlur() {
      const cellValue = this.textContent.trim();
      if (isEdited && validNumbers.has(cellValue)) {
        this.setAttribute("contenteditable", "false");
        this.removeEventListener("input", handleInput);
        this.removeEventListener("blur", handleBlur);
      } else if (cellValue === "") {
        isEdited = false;
      }
    });
  });
  function checkCell(cell) {
    let rowIndex = cell.parentNode.rowIndex;
    let cellIndex = cell.cellIndex;

    let rowCells = Array.from(table.rows[rowIndex].cells).slice(1);
    let rowPoints = calculatePoints(rowCells);
    updatePointsDisplay(table.rows[rowIndex].cells[0], rowPoints);

    let colCells = [];
    for (let i = 1; i <= 5; i++) {
      colCells.push(table.rows[i].cells[cellIndex]);
    }
    let colPoints = calculatePoints(colCells);
    updatePointsDisplay(table.rows[0].cells[cellIndex], colPoints);

    checkDiagonal1();
    checkDiagonal2();
  }

  function checkDiagonal1() {
    let diagonalCells = [];
    for (let i = 1; i <= 5; i++) {
      diagonalCells.push(table.rows[i].cells[i]);
    }
    let diagonalPoints = calculatePoints(diagonalCells);
    updatePointsDisplay(table.rows[0].cells[0], diagonalPoints);
  }

  function checkDiagonal2() {
    let diagonalCells = [];
    for (let i = 1; i <= 5; i++) {
      diagonalCells.push(table.rows[i].cells[6 - i]);
    }
    let diagonalPoints = calculatePoints(diagonalCells);
    updatePointsDisplay(table.rows[0].cells[6], diagonalPoints);
  }

  function calculatePoints(cells) {
    if (hasFiveOfAKind(cells)) {
      return 125;
    } else if (hasAdjacentFourOfAKind(cells)) {
      return 100;
    } else if (hasNonAdjacentFourOfAKind(cells)) {
      return 70;
    } else if (hasSortedSequence(cells)) {
      return 75;
    } else if (hasSortedReversedSequence(cells)) {
      return 75;
    } else if (hasUnsortedSequence(cells)) {
      return 50;
    } else if (hasUnsortedReversedSequence(cells)) {
      return 50;
    } else if (hasAdjacentPairAndTriplet(cells)) {
      return 50;
    } else if (hasPairAndTriplet(cells)) {
      return 40;
    } else if (hasAdjacentTwoPairs(cells)) {
      return 35;
    } else if (hasTwoPairs(cells)) {
      return 30;
    } else if (hasAdjacentTriplet(cells)) {
      return 25;
    } else if (hasTriplet(cells)) {
      return 20;
    } else if (hasAdjacentDuplicate(cells)) {
      return 15;
    } else if (hasDuplicate(cells)) {
      return 10;
    } else {
      return 0;
    }
  }

  function hasDuplicate(cells) {
    let values = [];
    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        if (values.includes(content)) {
          return true;
        }
        values.push(content);
      }
    }
    return false;
  }

  function hasAdjacentDuplicate(cells) {
    for (let i = 0; i < cells.length - 1; i++) {
      let content = cells[i].textContent.trim();
      let nextContent = cells[i + 1].textContent.trim();
      if (content !== '' && content === nextContent) {
        return true;
      }
    }
    return false;
  }

  function hasTriplet(cells) {
    let valueCount = {};
    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        valueCount[content] = (valueCount[content] || 0) + 1;
        if (valueCount[content] === 3) {
          return true;
        }
      }
    }
    return false;
  }

  function hasAdjacentTriplet(cells) {
    for (let i = 0; i < cells.length - 2; i++) {
      let content = cells[i].textContent.trim();
      let nextContent = cells[i + 1].textContent.trim();
      let nextNextContent = cells[i + 2].textContent.trim();
      if (content !== '' && content === nextContent && content === nextNextContent) {
        return true;
      }
    }
    return false;
  }

  function hasTwoPairs(cells) {
    let valueCount = {};
    let pairCount = 0;

    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        valueCount[content] = (valueCount[content] || 0) + 1;
        if (valueCount[content] === 2) {
          pairCount++;
          valueCount[content] = 0;
        }
      }
    }

    return pairCount >= 2;
  }

  function hasAdjacentTwoPairs(cells) {
    let pairCount = 0;
    for (let i = 0; i < cells.length - 1; i++) {
      let content = cells[i].textContent.trim();
      let nextContent = cells[i + 1].textContent.trim();
      if (content !== '' && content === nextContent) {
        pairCount++;
        i++;
      }
    }
    return pairCount >= 2;
  }

  function hasPairAndTriplet(cells) {
    let valueCount = {};
    let hasPair = false;
    let hasTriplet = false;

    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        valueCount[content] = (valueCount[content] || 0) + 1;
      }
    }

    for (let key in valueCount) {
      if (valueCount[key] === 2) {
        hasPair = true;
      }
      if (valueCount[key] === 3) {
        hasTriplet = true;
      }
    }

    return hasPair && hasTriplet;
  }

  function hasAdjacentPairAndTriplet(cells) {
    for (let i = 0; i < cells.length - 4; i++) {
      let first = cells[i].textContent.trim();
      let second = cells[i + 1].textContent.trim();
      let third = cells[i + 2].textContent.trim();
      let fourth = cells[i + 3].textContent.trim();
      let fifth = cells[i + 4].textContent.trim();
      if (
        first !== '' &&
        second !== '' &&
        third !== '' &&
        fourth !== '' &&
        fifth !== '' &&
        ((first === second && third === fourth && fourth === fifth) ||
          (first === second && second === third && fourth === fifth))
      ) {
        return true;
      }
    }
    return false;
  }

  function hasNonAdjacentFourOfAKind(cells) {
    let valueCount = {};
    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        valueCount[content] = (valueCount[content] || 0) + 1;
        if (valueCount[content] === 4) {
          return true;
        }
      }
    }
    return false;
  }

  function hasAdjacentFourOfAKind(cells) {
    for (let i = 0; i < cells.length - 3; i++) {
      let content = cells[i].textContent.trim();
      let nextContent = cells[i + 1].textContent.trim();
      let nextNextContent = cells[i + 2].textContent.trim();
      let nextNextNextContent = cells[i + 3].textContent.trim();
      if (content !== '' && content === nextContent && content === nextNextContent && content === nextNextNextContent) {
        return true;
      }
    }
    return false;
  }

  function hasFiveOfAKind(cells) {
    let valueCount = {};
    for (let cell of cells) {
      let content = cell.textContent.trim();
      if (content !== '') {
        valueCount[content] = (valueCount[content] || 0) + 1;
        if (valueCount[content] === 5) {
          return true;
        }
      }
    }
    return false;
  }

  function hasSortedSequence(cells) {
    let values = cells.map(cell => parseInt(cell.textContent.trim(), 10)).filter(Number.isInteger);
    return isSequential(values);
  }
  
  function hasUnsortedSequence(cells) {
    let values = cells.map(cell => parseInt(cell.textContent.trim(), 10)).filter(Number.isInteger);
    values.sort((a, b) => a - b);
    return isSequential(values);
  }
  
  function hasSortedReversedSequence(cells) {
    let values = cells.map(cell => parseInt(cell.textContent.trim(), 10)).filter(Number.isInteger);
    return isSequential(values.slice().reverse());
  }
  
  function hasUnsortedReversedSequence(cells) {
    let values = cells.map(cell => parseInt(cell.textContent.trim(), 10)).filter(Number.isInteger);
    values.sort((a, b) => b - a);
    return isSequential(values);
  }

  function isSequential(values) {
    if (values.length < 5) return false;
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) {
        return false;
      }
    }
    return true;
  }

  function updatePointsDisplay(headerCell, points) {
    headerCell.textContent = `${points}`;
    headerCell.setAttribute('data-points', points);
    headerCell.classList.add('has-points');
    updateTotalScore();
  }

  window.checkCell = checkCell;
});

function updateTotalScore() {
  const headerCells = document.querySelectorAll('#bonusTable th[data-points]');
  let totalScore = 0;
  headerCells.forEach(cell => {
    totalScore += parseInt(cell.getAttribute('data-points'), 10);
  });
  document.getElementById('totalScore').textContent = `Celkem bodů: ${totalScore}`;
}

updateTotalScore();

const originalNumbers = [
  1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
  5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8,
  9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12,
  13, 13, 13, 13, 'x', 'x'
];

let remainingNumbers = [];
let maxRolls = 25;
let lastGeneratedNumber = null;
let storedXValues = [];

function resetNumbers() {
  remainingNumbers = originalNumbers.slice();
  shuffleArray(remainingNumbers);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function rollDice() {
  if (rollCount === 24 && storedXValues.length === 2) {
    return handleStoredXValues();
  }
  
  if (rollCount === 25 && storedXValues.length === 1) {
    return handleStoredXValues();
  }

  if (remainingNumbers.length === 0 && storedXValues.length > 0) {
    return handleStoredXValues();
  }

  if (remainingNumbers.length === 0) {
    return null;
  }

  const result = remainingNumbers.pop();

  if (result === 'x') {
    const useNow = confirm("Chcete použít 'x' nyní (OK) nebo si ho odložit (Zrušit) ?");
    if (useNow) {
      const value = prompt("Zadejte hodnotu pro 'x':");
      return value;
    } else {
      storedXValues.push('x');
      maxRolls++;
      return rollDice();
    }
  }

  return result;
}


function resetTable() {
  location.reload();
  const cells = document.querySelectorAll('#bonusTable tbody td');
  cells.forEach(cell => {
    cell.textContent = '';
    cell.removeAttribute('disabled');
  });
  resetNumbers();
  rollCount = 0;
  rollButton.textContent = 'Generovat';
  rollButton.classList.remove('disabled');
  rollButton.disabled = false;
}

const rollButton = document.getElementById('rollButton');
const resultDisplay = document.getElementById('result');
const tableInputs = document.querySelectorAll('#bonusTable tbody td');
let rollCount = 0;

resetNumbers();

rollButton.addEventListener('click', function () {
  if (rollButton.textContent === 'Hrát znovu') {
    resetTable();
    return;
  }

  rollCount++;
  if (rollCount > maxRolls) {
    rollCount = 1;
    resetNumbers();
  }
  const result = rollDice();
  if (result !== null) {
    resultDisplay.textContent = `${rollCount}. číslo : ${result}`;
    lastGeneratedNumber = result;
    rollButton.disabled = true;
  } else {
    resultDisplay.textContent = `Už nejsou žádná další čísla k dispozici.`;
  }
  if (rollCount >= maxRolls - storedXValues.length) {
    handleStoredXValues();
    rollButton.textContent = 'Hrát znovu';
    rollButton.classList.add('disabled');
    rollButton.disabled = false;
  }
});

tableInputs.forEach(input => {
  input.addEventListener('click', function () {
    if (input.textContent.trim() === '' && lastGeneratedNumber !== null) {
      input.textContent = lastGeneratedNumber;
      input.setAttribute('disabled', 'true');
      input.classList.add('filled');
      rollButton.disabled = false;
      lastGeneratedNumber = null;
    }
  });
});

function handleStoredXValues() {
  while (storedXValues.length > 0) {
    const value = prompt("Zadejte hodnotu pro 'x':");
    if (value !== null && value !== '') {
      storedXValues.shift();
      maxRolls--;
      lastGeneratedNumber = value;
      return value;
    } else {
      alert("Zadejte platnou hodnotu!");
    }
  }
  return null;
}


setInterval(() => {
  const cells = document.querySelectorAll("td[contenteditable]");
  cells.forEach(cell => {
    checkCell(cell);
  });
}, 100);