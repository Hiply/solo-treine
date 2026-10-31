/* ===================== PORTAL SHOP // ITENS E AVATAR ===================== */
(function (global) {
  'use strict';

  const PORTAL_RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'MONARCH'];
  const SLOT_LABELS = {
    weapon: 'ARMA',
    head: 'CABEÇA',
    armor: 'ARMADURA',
    gloves: 'LUVAS',
    back: 'COSTAS'
  };
  const ITEMS = [
    { id: 'e-dagger', rank: 'E', slot: 'weapon', name: 'Adaga do Despertar', price: 80, image: 'assets/shop/item-e-dagger.png', description: 'Uma lâmina leve para os primeiros portais.' },
    { id: 'd-hood', rank: 'D', slot: 'head', name: 'Capuz do Explorador', price: 180, image: 'assets/shop/item-d-hood.png', description: 'Proteção simples feita para incursões longas.' },
    { id: 'c-scale', rank: 'C', slot: 'armor', name: 'Couraça de Escamas', price: 350, image: 'assets/shop/item-c-scale.png', description: 'Placas resistentes com encaixes arcanos.' },
    { id: 'b-gauntlets', rank: 'B', slot: 'gloves', name: 'Manoplas Rúnicas', price: 700, image: 'assets/shop/item-b-gauntlets.png', description: 'Reforçam a firmeza e a presença do caçador.' },
    { id: 'a-cloak', rank: 'A', slot: 'back', name: 'Manto da Fenda', price: 1300, image: 'assets/shop/item-a-cloak.png', description: 'Tecido raro marcado pela energia de uma fenda.' },
    { id: 's-shadowblade', rank: 'S', slot: 'weapon', name: 'Lâmina da Sombra', price: 2600, image: 'assets/shop/item-s-shadowblade.png', description: 'Uma arma de alto rank forjada para caçadores S.' },
    { id: 's-monarch-armor', rank: 'S', slot: 'armor', name: 'Couraça do Monarca', price: 3200, image: 'assets/shop/item-s-armor.png', description: 'Armadura de elite com brilho azul profundo.' },
    { id: 'monarch-crown', rank: 'MONARCH', slot: 'head', name: 'Coroa Absoluta', price: 6000, image: 'assets/shop/item-monarch-crown.png', description: 'Relíquia suprema, reservada a portais Monarca.' },
    { id: 'monarch-wings', rank: 'MONARCH', slot: 'back', name: 'Asas da Fenda', price: 7000, image: 'assets/shop/item-monarch-wings.png', description: 'Manto lendário que anuncia o soberano do portal.' }
  ];

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function state() {
    return global.__systemApp?.state || null;
  }

  function shopState() {
    const current = state();
    if (!current) return null;
    if (!current.shop || typeof current.shop !== 'object') {
      current.shop = { coins: 0, clearedPortalRanks: {}, ownedItems: [], equipped: {} };
    }
    current.shop.clearedPortalRanks ||= {};
    current.shop.ownedItems = Array.isArray(current.shop.ownedItems) ? current.shop.ownedItems : [];
    current.shop.equipped ||= {};
    return current.shop;
  }

  function rankIndex(rankId) {
    return PORTAL_RANKS.indexOf(rankId);
  }

  function playerRank(level) {
    if (level >= 100) return 'MONARCH';
    if (level >= 60) return 'S';
    if (level >= 40) return 'A';
    if (level >= 30) return 'B';
    if (level >= 20) return 'C';
    if (level >= 10) return 'D';
    return 'E';
  }

  function hasClearedRank(requiredRank) {
    const shop = shopState();
    const requiredIndex = rankIndex(requiredRank);
    if (!shop || requiredIndex < 0) return false;
    return PORTAL_RANKS.some((rank, index) => index >= requiredIndex && Number(shop.clearedPortalRanks[rank]) > 0);
  }

  function highestClearedRank() {
    const shop = shopState();
    if (!shop) return null;
    return [...PORTAL_RANKS].reverse().find(rank => Number(shop.clearedPortalRanks[rank]) > 0) || null;
  }

  function refreshBalance() {
    const shop = shopState();
    if (!shop) return;
    const coins = Math.max(0, Math.floor(Number(shop.coins) || 0));
    const formatted = coins.toLocaleString('pt-BR');
    const balance = $('#shopCoins');
    const tabBalance = $('#shopTabCoins');
    const topBalance = $('#coinBalance');
    if (balance) balance.textContent = `${formatted} ◈`;
    if (tabBalance) tabBalance.textContent = `${formatted} ◈`;
    if (topBalance) topBalance.textContent = formatted;
  }

  function renderEquipment() {
    const shop = shopState();
    const container = $('#equipmentSlots');
    if (!shop || !container) return;

    container.innerHTML = Object.entries(SLOT_LABELS).map(([slot, label]) => {
      const equippedId = shop.equipped[slot];
      const item = ITEMS.find(entry => entry.id === equippedId && entry.slot === slot);
      if (!item || !shop.ownedItems.includes(item.id)) {
        return `<div class="equipment-slot empty"><span class="equipment-slot-name">${label}</span><span class="equipment-slot-icon">＋</span><b>VAZIO</b></div>`;
      }
      return `<div class="equipment-slot equipped" data-rank="${item.rank}">
        <span class="equipment-slot-name">${label}</span>
        <div class="equipment-slot-art"><img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy"><span>◈</span></div>
        <b>${escapeHtml(item.name)}</b>
        <button class="unequip-button" type="button" data-unequip="${item.slot}" aria-label="Desequipar ${escapeHtml(item.name)}">DESEQUIPAR</button>
      </div>`;
    }).join('');
    container.querySelectorAll('.equipment-slot-art img').forEach(image => {
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    });
  }

  function itemAction(item, shop) {
    const owned = shop.ownedItems.includes(item.id);
    if (owned && shop.equipped[item.slot] === item.id) return { label: 'EQUIPADO', action: 'none', disabled: true, className: 'item-action equipped' };
    if (owned) return { label: 'EQUIPAR', action: 'equip', disabled: false, className: 'item-action' };
    if (!hasClearedRank(item.rank)) return { label: `LIMPE UM PORTAL ${item.rank}`, action: 'locked', disabled: true, className: 'item-action locked' };
    if (Number(shop.coins) < item.price) return { label: 'MOEDAS INSUFICIENTES', action: 'buy', disabled: true, className: 'item-action locked' };
    return { label: 'COMPRAR', action: 'buy', disabled: false, className: 'item-action' };
  }

  function renderGrid() {
    const shop = shopState();
    const grid = $('#shopGrid');
    const status = $('#shopGateStatus');
    if (!shop || !grid) return;

    const highest = highestClearedRank();
    if (status) {
      status.textContent = highest
        ? `Maior portal limpo: ${highest} • recompensas recebidas por rank: ${PORTAL_RANKS.filter(rank => Number(shop.clearedPortalRanks[rank]) > 0).join(', ')}`
        : 'Nenhum portal limpo ainda. As moedas e o acesso à loja começam nas suas primeiras limpezas.';
      status.classList.toggle('has-gates', !!highest);
    }

    grid.innerHTML = ITEMS.map(item => {
      const action = itemAction(item, shop);
      const unlocked = hasClearedRank(item.rank);
      const owned = shop.ownedItems.includes(item.id);
      return `<article class="shop-item-card ${unlocked ? '' : 'is-locked'}" data-rank="${item.rank}">
        <div class="shop-item-art"><img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy"><span class="shop-art-fallback" aria-hidden="true">◈</span><span class="shop-item-rank">${item.rank}</span></div>
        <div class="shop-item-body">
          <div class="shop-item-slot">${SLOT_LABELS[item.slot]}${owned ? '<span class="owned-mark">ADQUIRIDO</span>' : ''}</div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <div class="shop-item-price"><span>PREÇO</span><b>◈ ${item.price.toLocaleString('pt-BR')}</b></div>
          <button type="button" class="${action.className}" data-shop-action="${action.action}" data-item-id="${item.id}" ${action.disabled ? 'disabled' : ''}>${action.label}</button>
        </div>
      </article>`;
    }).join('');
    grid.querySelectorAll('.shop-item-art img').forEach(image => {
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    });
  }

  function render() {
    const current = state();
    if (!current) return;
    refreshBalance();
    renderEquipment();
    renderGrid();
    const characterName = $('#shopCharacterName');
    const playerName = $('#playerName');
    if (characterName) characterName.textContent = (playerName?.textContent || current.profile?.name || 'JOGADOR DESPERTADO').trim();
    const rank = $('#avatarRank');
    if (rank) {
      const rankId = playerRank(current.level);
      rank.textContent = rankId === 'MONARCH' ? 'MONARCA DAS SOMBRAS' : `${rankId}-RANK`;
      rank.dataset.rank = rankId;
    }
  }

  function saveAndRender() {
    global.__systemApp?.save?.();
    render();
  }

  function buyOrEquip(itemId, action) {
    const current = state();
    const shop = shopState();
    const item = ITEMS.find(entry => entry.id === itemId);
    if (!current || !shop || !item) return;

    if (action === 'buy') {
      if (!hasClearedRank(item.rank)) {
        global.showToast?.('PORTAL NECESSÁRIO', `Limpe um portal ${item.rank} ou superior para liberar este item.`);
        return;
      }
      if (shop.ownedItems.includes(item.id)) return;
      if (Number(shop.coins) < item.price) {
        global.showToast?.('SALDO INSUFICIENTE', 'Limpe mais portais para juntar moedas.');
        return;
      }
      shop.coins -= item.price;
      shop.ownedItems.push(item.id);
      global.SystemSound?.play('confirm');
      global.showToast?.('ITEM ADQUIRIDO', `${item.name} entrou no seu inventário.`);
      saveAndRender();
      return;
    }

    if (action === 'equip') {
      if (!shop.ownedItems.includes(item.id)) return;
      shop.equipped[item.slot] = item.id;
      global.SystemSound?.play('confirm');
      global.showToast?.('EQUIPAMENTO ATUALIZADO', `${item.name} equipado no espaço ${SLOT_LABELS[item.slot]}.`);
      saveAndRender();
    }
  }

  function bind() {
    $('#shopGrid')?.addEventListener('click', event => {
      const button = event.target.closest('[data-shop-action]');
      if (!button || button.disabled || button.dataset.shopAction === 'none' || button.dataset.shopAction === 'locked') return;
      buyOrEquip(button.dataset.itemId, button.dataset.shopAction);
    });

    $('#equipmentSlots')?.addEventListener('click', event => {
      const button = event.target.closest('[data-unequip]');
      if (!button) return;
      const shop = shopState();
      if (!shop) return;
      delete shop.equipped[button.dataset.unequip];
      global.SystemSound?.play('click');
      saveAndRender();
    });

    const avatar = $('#shopAvatar');
    avatar?.addEventListener('error', () => {
      avatar.hidden = true;
      const fallback = $('#shopAvatarFallback');
      if (fallback) fallback.hidden = false;
    });
    if (avatar?.complete && avatar.naturalWidth === 0) {
      avatar.hidden = true;
      const fallback = $('#shopAvatarFallback');
      if (fallback) fallback.hidden = false;
    }
  }

  global.SystemShop = { render, refreshBalance, items: ITEMS };
  bind();
  render();
})(typeof window !== 'undefined' ? window : globalThis);
