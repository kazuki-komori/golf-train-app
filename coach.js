// 初心者向けの言葉で「いま何が起きているか」と「直し方」を返す

export function sides(handed) {
  // lead = 目標側の手・腰, trail = 反対側
  return handed === 'left' ? { lead: '右', trail: '左' } : { lead: '左', trail: '右' };
}

export function coachTips(r, settings) {
  const { lead, trail } = sides(settings.handed);
  const failed = new Set(r.checks.filter((c) => !c.pass).map((c) => c.key));
  const tips = [];

  if (failed.has('face')) {
    if (r.face > 0) {
      tips.push({
        title: 'クラブの面が開いて当たっています',
        now: `インパクトでクラブの面が${trail}を向いたままです。ボールを横からこすってしまい、${trail}へ逃げていきます。`,
        fix: `${lead}手の甲で「ボールを地面に押さえつける」つもりで振りましょう。握手をするときの手の形で、ボールをたたく感じです。`,
        drill: `腰から腰までの小さな振り幅で素振りし、振り終わりにクラブの先が真上を向いていれば合格です。`,
      });
    } else {
      tips.push({
        title: 'クラブの面が閉じて当たっています',
        now: `インパクトでクラブの面が${lead}を向いています。ボールが${lead}へ引っかかります。`,
        fix: '手首をこねて面を返しすぎています。手で返すのではなく、おへそを目標に向けるように体を回し、腕はそれについていくだけにしましょう。',
        drill: '振り終わりで、おへそが目標を向くまで回り切り、その形で3秒止まる素振りをくり返します。',
      });
    }
  }

  if (failed.has('tempo')) {
    if (r.tempo < settings.targetTempo) {
      tips.push({
        title: '打ち急いでいます',
        now: '上げるのが速すぎて、トップから慌てて打ちにいっています。力が入り、当たりがばらつきます。',
        fix: '「いーち、にー、さん」で上げて、「しっ」で振り下ろします。上げるときはゆっくり、下ろすときだけ速く。',
        drill: '設定でリズムガイドをオンにして、3つめの音でちょうどボールの位置を通過するように振ります。',
      });
    } else {
      tips.push({
        title: '上げるのがゆっくりすぎます',
        now: 'トップでクラブの勢いが止まってしまい、下ろすときに手の力に頼っています。',
        fix: 'ブランコのように、上げた勢いのまま自然に切り返しましょう。トップで止めないことが大切です。',
        drill: 'リズムガイドの音に合わせて、止まらずに3回続けて素振りします。',
      });
    }
  }

  // 軌道（面のずれ・クラブの通り道）は同じ原因なのでまとめる
  const pathBad = failed.has('path') || failed.has('plane');
  if (pathBad) {
    const outside = r.clubPath != null ? r.clubPath < 0 : r.planeDir === 'steep';
    if (outside) {
      tips.push({
        title: '外側から振り下ろしています（アウトサイドイン）',
        now: 'クラブが上げたときより外側（体から遠い側）から下りてきて、ボールを外から内へこすっています。スライスのいちばんの原因です。',
        fix: `切り返しで、${trail}ひじを${trail}腰のポケットの前にストンと落とすイメージです。肩から先に回さず、背中を目標に向けたまま下ろし始めます。`,
        drill: 'ボールの向こう側（体から遠い側）にタオルやペットボトルを置き、それに当てないように振ります。',
      });
    } else {
      tips.push({
        title: '内側から振りすぎています（インサイドアウト）',
        now: 'クラブが体の内側から下りすぎて、下からすくい上げる形になっています。右や左へのミスが両方出やすくなります。',
        fix: `腰の回転が止まって、手だけが前に出ています。${lead}腰を後ろへ引くように回り続け、クラブを体の正面に置いたまま振り抜きましょう。`,
        drill: 'ボールの手前（自分側）にタオルを置き、それに当てないように振ります。',
      });
    }
  }

  if (!tips.length) {
    tips.push({
      title: 'お手本に近いスイングです',
      now: 'フェースの向き、リズム、通り道がそろっています。',
      fix: 'この感覚が残っているうちに、同じリズムでもう1回振りましょう。',
      drill: '慣れてきたら、設定で判定を1段厳しくしてみてください。',
    });
  }
  return tips;
}

// 物理シミュレーションの結果を言葉にする（shape, fl は flight.js）
export function describeShot(shape, fl, handed) {
  const { lead, trail } = sides(handed);
  const dir = (v) => (v > 0 ? trail : lead);
  const start = shape.start === 0 ? 'まっすぐ飛び出して' : `${dir(shape.start)}に飛び出して`;
  const c = shape.curve;
  const curve = c === 0 ? 'そのまま進み' : Math.abs(c) === 1 ? `少し${dir(c)}へ曲がり` : `大きく${dir(c)}へ曲がり`;
  const off = fl.offline;
  const where = Math.abs(off) < 5 ? 'ほぼ真ん中です' : `目標から${dir(off)}へ${Math.round(Math.abs(off))}mずれます`;
  const rough = Math.abs(off) > 18 ? '。フェアウェイを外れてしまいます' : '';
  return `${start}、${curve}、${Math.round(fl.carry)}m先に落ちて${Math.round(fl.total)}mで止まります。${where}${rough}。`;
}

// インパクト図の説明
export function describeImpact(r, handed) {
  const { lead, trail } = sides(handed);
  const dir = (v) => (v > 0 ? trail : lead);
  const p = r.clubPath ?? 0;
  const f = r.face;
  const pathTxt = Math.abs(p) < 1 ? 'クラブは目標ラインに沿って動き' : p > 0 ? `クラブは内側から外へ ${Math.abs(p).toFixed(1)}° 動き` : `クラブは外側から内へ ${Math.abs(p).toFixed(1)}° 動き`;
  const faceTxt = Math.abs(f) < 1 ? 'フェースは目標を向いています' : `フェースは目標より${dir(f)}を ${Math.abs(f).toFixed(1)}° 向いています`;
  const d = f - p;
  let spin;
  if (Math.abs(d) < 2) spin = 'フェースと通り道がそろっているので、ボールはほとんど曲がりません。';
  else spin = `フェースが通り道より${dir(d)}を向いているので、ボールに${dir(d)}回転がかかり${dir(d)}へ曲がります。`;
  return `${pathTxt}、${faceTxt}。${spin}ボールが飛び出す向きはフェースの向きで、曲がり方は「フェースと通り道の差」でほぼ決まります。`;
}
