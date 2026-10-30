/* 当前游戏的 18 个军衔，各取 CF 同名军衔的第 1 级图标。 */
(function (global) {
  'use strict';

  const files = Object.freeze({
    '列兵': '001_列兵1.jpg', '二等兵': '004_二等兵.jpg',
    '一等兵': '005_一等兵.jpg', '上等兵': '006_上等兵1.jpg',
    '下士': '010_下士1.jpg', '中士': '016_中士1.jpg',
    '上士': '022_上士1.jpg', '少尉': '028_少尉1.jpg',
    '中尉': '036_中尉1.jpg', '上尉': '044_上尉1.jpg',
    '少校': '052_少校1.jpg', '中校': '060_中校1.jpg',
    '上校': '068_上校1.jpg', '大校': '076_大校1.jpg',
    '少将': '082_少将1.jpg', '中将': '088_中将1.jpg',
    '上将': '094_上将1.jpg', '元帅': '100_元帅.jpg',
  });

  function icon(name, className = 'cfRankIcon') {
    const file = files[name];
    if (!file) return null;
    const img = document.createElement('img');
    img.className = className;
    img.src = '/web/assets/ranks/source/' + encodeURIComponent(file);
    img.alt = '';
    img.title = name;
    img.width = 24;
    img.height = 24;
    return img;
  }

  global.CFRankIcons = { files, icon };
})(window);
