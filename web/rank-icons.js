/* 当前游戏的 18 个军衔，各取 CF 同名军衔的第 1 级图标。 */
(function (global) {
  'use strict';

  const files = Object.freeze({
    '列兵': '001_private_1.jpg', '二等兵': '004_private_2c.jpg',
    '一等兵': '005_private_1c.jpg', '上等兵': '006_lance_corporal_1.jpg',
    '下士': '010_corporal_1.jpg', '中士': '016_sergeant_1.jpg',
    '上士': '022_staff_sergeant_1.jpg', '少尉': '028_second_lieutenant_1.jpg',
    '中尉': '036_first_lieutenant_1.jpg', '上尉': '044_captain_1.jpg',
    '少校': '052_major_1.jpg', '中校': '060_lieutenant_colonel_1.jpg',
    '上校': '068_colonel_1.jpg', '大校': '076_senior_colonel_1.jpg',
    '少将': '082_major_general_1.jpg', '中将': '088_lieutenant_general_1.jpg',
    '上将': '094_general_1.jpg', '元帅': '100_marshal.jpg',
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
