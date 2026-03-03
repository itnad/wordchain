    // Explicitly check if required data is present in the server response
    if (!data || !data.display_name || !data.nickname) {
      throw new Error('서버에서 필요한 사용자 정보(이름, 닉네임)를 받지 못했습니다. 서버 응답 형식을 확인해주세요.');
    }