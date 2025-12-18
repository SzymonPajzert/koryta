const fs = require('fs');
const path = require('path');

const nodes = {};
const edges = [];
const nodeGroups = [];

// Helper to create node
function createNode(id, name, type) {
    nodes[id] = { id, name, type, stats: { people: 1 }, sizeMult: 1, color: '#000000' };
    if (type === 'place') {
        nodeGroups.push({ id, name, stats: { people: 1 }, connected: [id] });
    }
}

// Helper to create edge
function createEdge(source, target) {
    edges.push({ source, target, id: `${source}-${target}`, label: 'test' });
    
    // Add to connected list of place groups
    const sourceGroup = nodeGroups.find(g => g.id === source);
    if (sourceGroup) {
        if (!sourceGroup.connected.includes(target)) sourceGroup.connected.push(target);
    }
    const targetGroup = nodeGroups.find(g => g.id === target);
    if (targetGroup) {
        if (!targetGroup.connected.includes(source)) targetGroup.connected.push(source);
    }
}

// Specific entities required by graph.cy.js
createNode('place_krakow', 'Miasto Kraków', 'place');
createNode('1', 'Jan Kowalski', 'person'); // ID 1 matches seed
createNode('person_miszalski', 'Aleksander Miszalski', 'person');
createEdge('person_miszalski', 'place_krakow');

createNode('place_nfosigw', 'NFOŚiGW', 'place');
createNode('person_patalas', 'Ewa Patalas', 'person');
createNode('person_misko', 'Waldemar Miśko', 'person');
createNode('person_kaczmarek', 'Jerzy Kaczmarek', 'person');
createNode('place_wfosigw', 'WFOŚiGW Kraków', 'place');
createNode('person_zamaro', 'Marcin Zamaro', 'person');
createEdge('person_patalas', 'place_nfosigw');
createEdge('person_misko', 'place_nfosigw');
createEdge('person_kaczmarek', 'place_nfosigw');
createEdge('place_wfosigw', 'place_nfosigw');
createEdge('person_zamaro', 'place_nfosigw');

createNode('article_kanalizacja', 'NFOŚiGW wesprze budowę kanalizacji w Krakowie ', 'article'); // Note trailing space in test
createEdge('article_kanalizacja', 'place_nfosigw');
createEdge('article_kanalizacja', 'place_krakow');

createNode('place_warszawa', 'Miasto Warszawa', 'place');
createNode('person_bartelski', 'Wojciech Bartelski', 'person');
createNode('place_polimex', 'Polimex-Mostostal', 'place');
createEdge('person_bartelski', 'place_warszawa');
createEdge('person_bartelski', 'place_polimex');

createNode('place_wodny', 'Wodny Park Warszawianka', 'place');
createNode('person_pastor', 'Dariusz Pastor', 'person');
createNode('place_ursus', 'Ursus (Warszawa)', 'place');
createEdge('person_pastor', 'place_wodny');
createEdge('person_pastor', 'place_ursus');

// Add "Rząd" as it is checked in "displays a lot of nodes"
createNode('place_rzad', 'Rząd', 'place');

// Fill to > 100 nodes
for (let i = 0; i < 40; i++) {
    createNode(`extra_${i}`, `Extra Node ${i}`, 'person');
}

// Add a default group for "Lista wszystkich"
nodeGroups.unshift({
    id: 'all',
    name: 'Wszystkie',
    stats: { people: Object.keys(nodes).length },
    connected: Object.keys(nodes)
});

const data = {
    nodes,
    edges,
    nodeGroups
};

fs.writeFileSync(path.join(__dirname, '../cypress/fixtures/graph_data.json'), JSON.stringify(data, null, 2));
console.log('Fixture generated at cypress/fixtures/graph_data.json');
