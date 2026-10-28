import { Ui } from '../ui/icons';
import { Empty } from '../ui/parts';

export function StatsView() {
  return (
    <div class="stats-view">
      <Empty title="통계는 다음 릴리스(R2)에서 제공됩니다">
        <p>월별·분류별·사용자별·지불수단별 지출을 그래프와 표로 볼 수 있게 됩니다.</p>
        <p class="hint">
          <Ui name="Info" size={14} /> 지금은 사용 내역 화면의 월 요약과 구분별 합계를 이용해 주세요.
        </p>
      </Empty>
    </div>
  );
}
