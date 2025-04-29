function renderJSON(key, value, container) {
    if (typeof value === 'object' && value !== null) {
        var keyElement = document.createElement('div');
        keyElement.className = 'json-key';
        keyElement.textContent = key !== null ? key + ' {' : '{';
        keyElement.addEventListener('click', function() {
            var content = this.nextSibling;
            if (content.style.display === 'none') {
                content.style.display = 'block';
            } else {
                content.style.display = 'none';
            }
        });
        container.appendChild(keyElement);

        var objectContainer = document.createElement('div');
        objectContainer.className = 'json-container';
        objectContainer.style.display = 'none';
        for (var k in value) {
            renderJSON(k, value[k], objectContainer);
        }
        container.appendChild(objectContainer);

        var closingBracket = document.createElement('div');
        closingBracket.textContent = '}';
        container.appendChild(closingBracket);
    } else {
        var valueElement = document.createElement('div');
        valueElement.textContent = key + ': ' + JSON.stringify(value);
        container.appendChild(valueElement);
    }
}

var container = document.getElementById('jsonContainer');
renderJSON(null, jsonData, container);
