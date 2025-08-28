// Simple localization system (URL param: ?lang=en or ?lang=ru)
// Usage: import { t } from '../core/i18n.js';  t('path.to.key', {var:"value"})

const urlParams = new URLSearchParams(window.location.search);
export const currentLang = (function(){
  const p = (urlParams.get('lang')||'').toLowerCase();
  if(p==='ru'||p==='rus'||p==='ru-ru') return 'ru';
  return 'en';
})();

const dict = {
  en: {
    title: 'Caravan Tycoon',
    btn: {
      buildInn: 'Build Caravanserai (💰200)',
      mute: 'Mute',
      unmute: 'Unmute',
      cities: 'Cities',
      strategy: 'Management',
      buyCaravan: '+ Caravan',
      caravanLimit: 'Caravan limit',
      addCamel: 'Add camel'
    },
    section: { strategy: 'Strategy', caravans: 'Caravans' },
    strategy: { good: 'Good', buyLE: 'BUY<=', sellGE: 'SELL>=', range: 'Range' },
    caravan: {
      state: { travel: 'traveling', trade: 'trading', idle: 'idle' },
      addCamelLimit: 'Caravan #{id}: camel limit.',
      addCamelNoMoney: 'Not enough money for camel: need {cost}.',
      addCamelAdded: 'Added camel to caravan #{id}. Now {count}.',
  none: 'No caravans',
  target: 'Target',
  camels: 'Camels',
  filled: 'Filled'
    },
    goods: { spice: 'Spice', cloth: 'Cloth', ore: 'Ore' },
    stats: {
      money: 'Money', level: 'Level', xp: 'XP', totalProfit: 'Total Profit', lastTrade: 'Last Trade', goods: 'Goods store', caravans: 'Caravans', camelsTotal: 'Camels total', camelLimit: 'limit', day: 'Day', paused: 'PAUSED'
    },
    legend: { desert: 'Desert', oasis: 'Oasis', route: 'Route', caravan: 'Caravan', inn: 'Inn', bandits: 'Bandits' },
    tooltip: { price: 'Price', stock: 'Stock', netFlow: 'Net flow', priceRangePct: 'Price % range', axes: 'X axis: time (h) / Y axis: price (global range)' },
  time: { hoursShort: 'h', delta: 'Δ {hours}{unit}' },
    events: {
      stormLost: 'Sandstorm destroyed {loss} goods.',
      fair: 'Random fair brought {bonus}.',
      camelLost: 'Camel of caravan #{id} ran away.',
      banditsSteal: 'Bandits raided camp: stole {loss}.',
      banditsFail: 'Bandits tried to raid but caravans escaped.'
    },
    welcome: 'Welcome to the desert. Begin trading.',
  build: {},
    trade: {
      sold: 'Caravan #{id} sold {qty} {good} in {city} at {price} (profit {profit})',
      profit: 'Profit +{profit}',
      bought: 'Caravan #{id} bought {qty} {good} in {city} at {price}',
      balance: 'Balance {delta}',
      nothing: 'Caravan #{id} did not trade in {city}'
    },
    level: {
      camelLimit: 'Camel limit: {n}',
      caravanLimit: 'Caravan limit: {n}',
      cityUnlocked: 'New city unlocked: {name}',
      goodUnlocked: 'New good unlocked: {name}',
      cityGrew1: 'City grew.',
      cityGrew2: 'Cities are growing.',
      cityGrowth: 'City growth.',
      cityLarge: 'Large city forming.',
      newLevel: 'New level!',
      up: 'Level {n}',
      cityGrewLog: 'City {name} grew ({size}).'
    },
    roles: { PRODUCER:'Producer', CONSUMER:'Consumer', HUB:'Hub', SCARCE:'Scarce' },
  tips: 'Orbit Cam: Mouse drag rotate, Wheel zoom. W/S move forward/back, A/D strafe, Arrows rotate/tilt, Shift = faster. P: pause.'
  },
  ru: {
    title: 'Караван-Тайкун',
    btn: {
      buildInn: 'Построить караван-сарай (💰200)',
      mute: 'Звук выкл',
      unmute: 'Звук вкл',
      cities: 'Города',
      strategy: 'Управление',
      buyCaravan: '+ Караван',
      caravanLimit: 'Лимит караванов',
      addCamel: 'Добавить верблюда'
    },
    section: { strategy: 'Стратегия', caravans: 'Караваны' },
    strategy: { good: 'Товар', buyLE: 'BUY<=', sellGE: 'SELL>=', range: 'Диапазон' },
    caravan: {
      state: { travel: 'в пути', trade: 'торгует', idle: 'ожидает' },
      addCamelLimit: 'Караван #{id}: лимит верблюдов.',
      addCamelNoMoney: 'Недостаточно денег для верблюда: нужно {cost}.',
      addCamelAdded: 'Добавлен верблюд в караван #{id}. Теперь {count}.',
  none: 'Нет караванов',
  target: 'Цель',
  camels: 'Верблюды',
  filled: 'Заполн'
    },
    goods: { spice: 'Пряности', cloth: 'Текстиль', ore: 'Руда' },
    stats: {
      money: 'Деньги', level: 'Уровень', xp: 'Опыт', totalProfit: 'Всего профит', lastTrade: 'Последняя сделка', goods: 'Товаров', caravans: 'Караваны', camelsTotal: 'Всего верблюдов', camelLimit: 'лимит', day: 'День', paused: 'ПАУЗА'
    },
    legend: { desert: 'Пустыня', oasis: 'Оазис', route: 'Маршрут', caravan: 'Караван', inn: 'Инн', bandits: 'Бандиты' },
  tooltip: { price: 'Цена', stock: 'Запасы', netFlow: 'Чистый поток', priceRangePct: 'Цена % диапазона', axes: 'Ось X: время (ч) / Ось Y: цена (глобальный диапазон)' },
  time: { hoursShort: 'ч', delta: 'Δ {hours}{unit}' },
    events: {
      stormLost: 'Песчаная буря уничтожила {loss} ед. товара.',
      fair: 'Случайная ярмарка принесла {bonus}.',
      camelLost: 'Верблюд каравана #{id} убежал.',
      banditsSteal: 'Бандиты атаковали с лагеря: украли {loss}.',
      banditsFail: 'Бандиты попытались атаковать, но караваны ушли.'
    },
    welcome: 'Добро пожаловать в пустыню. Начинаем торговлю.',
  build: {},
    trade: {
      sold: 'Караван #{id} продал {qty} {good} в {city} по {price} (профит {profit})',
      profit: 'Профит +{profit}',
      bought: 'Караван #{id} купил {qty} {good} в городе {city} по {price}',
      balance: 'Баланс {delta}',
      nothing: 'Караван #{id} ничего не купил/продал в {city}'
    },
    level: {
      camelLimit: 'Лимит верблюдов: {n}',
      caravanLimit: 'Лимит караванов: {n}',
      cityUnlocked: 'Открыт новый город: {name}',
      goodUnlocked: 'Открыт новый товар: {name}',
      cityGrew1: 'Город вырос.',
      cityGrew2: 'Города растут.',
      cityGrowth: 'Рост города.',
      cityLarge: 'Крупный город формируется.',
      newLevel: 'Новый уровень!',
      up: 'Уровень {n}',
      cityGrewLog: 'Город {name} вырос ({size}).'
    },
    roles: { PRODUCER:'Производитель', CONSUMER:'Потребитель', HUB:'Хаб', SCARCE:'Дефицит' },
  tips: 'Orbit Cam: перетаскивание мышью вращает, колесо зум. W/S вперед/назад, A/D вбок, стрелки вращ/наклон, Shift быстрее. P: пауза.'
  }
};

export function t(key, vars){
  const segs = key.split('.');
  let cur = dict[currentLang];
  for(const s of segs){ if(cur && typeof cur === 'object' && s in cur) cur = cur[s]; else { cur = null; break; } }
  if(cur == null){ // fallback english
    cur = segs.reduce((o,s)=> (o&&o[s]!=null)? o[s]: null, dict.en);
  }
  if(typeof cur !== 'string') return key; // not found or nested object
  if(vars){ for(const k of Object.keys(vars)){ cur = cur.replace(new RegExp('\\{'+k+'\\}','g'), vars[k]); } }
  return cur;
}

export function applyGoodsNames(GOODS){
  for(const gid of Object.keys(GOODS)){
    if(dict[currentLang] && dict[currentLang].goods[gid]) GOODS[gid].name = dict[currentLang].goods[gid];
    else if(dict.en.goods[gid]) GOODS[gid].name = dict.en.goods[gid];
  }
}

export function roleLabel(role){ return t('roles.'+role); }

export function localizeStaticDOM(){
  const h1=document.querySelector('#mainMenu h1'); if(h1) h1.textContent=t('title');
  const build=document.getElementById('buildInn'); if(build) build.textContent=t('btn.buildInn');
  const sound=document.getElementById('toggleSound'); if(sound) sound.textContent=t('btn.mute');
  const citiesBtn=document.querySelector('#windowsMenu button[data-win="cities"]'); if(citiesBtn) citiesBtn.textContent=t('btn.cities');
  const stratBtn=document.querySelector('#windowsMenu button[data-win="strategy"]'); if(stratBtn) stratBtn.textContent=t('btn.strategy');
  const tips=document.getElementById('tips'); if(tips) tips.textContent=t('tips');
  const winCities=document.querySelector('#win-cities .titlebar span'); if(winCities) winCities.textContent=t('btn.cities');
  const winStrat=document.querySelector('#win-strategy .titlebar span'); if(winStrat) winStrat.textContent=t('btn.strategy');
  const stratHead=document.querySelector('#strategySection .section-head'); if(stratHead) stratHead.textContent=t('section.strategy');
  const carHead=document.querySelector('#caravansSection .section-head'); if(carHead) carHead.textContent=t('section.caravans');
}
